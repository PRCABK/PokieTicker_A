import logging

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

from backend.config import settings
from backend.database import get_conn
from backend.tushare.client import fetch_ohlc, fetch_news  # noqa: F401
from backend.pipeline.layer0 import run_layer0
from backend.pipeline.layer1 import run_layer1
from backend.pipeline.alignment import align_news_for_symbol

import json

router = APIRouter()


class FetchRequest(BaseModel):
    symbol: str
    start: Optional[str] = None
    end: Optional[str] = None


class ProcessRequest(BaseModel):
    symbol: str
    batch_size: int = 1000


class TrainRequest(BaseModel):
    symbol: str


@router.post("/train")
def trigger_train(req: TrainRequest, background_tasks: BackgroundTasks):
    """Train XGBoost models (t1 + t3 + t5) for a symbol."""
    symbol = req.symbol.upper()
    background_tasks.add_task(_do_train, symbol)
    return {"symbol": symbol, "status": "training_started"}


def _do_train(symbol: str):
    """Background model training. Auto-fetches data if insufficient."""
    from backend.ml.model import train
    from backend.ml.features import build_features

    # Check if we have enough data
    df = build_features(symbol)
    if df.empty or len(df) < 60:
        logger.info("Train %s: only %d rows, auto-fetching history...", symbol, len(df))
        today = datetime.now(timezone.utc).date()
        start = (today - timedelta(days=2 * 366)).isoformat()
        end = today.isoformat()

        # Ensure ticker exists in DB
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT IGNORE INTO tickers (symbol, name) VALUES (%s, %s)",
                    (symbol, symbol),
                )
            conn.commit()
        finally:
            conn.close()

        # Fetch data synchronously (we're already in background)
        _do_fetch(symbol, start, end, auto_train=False)

        # Re-check after fetch
        df = build_features(symbol)
        if df.empty or len(df) < 60:
            logger.warning("Train %s: still only %d rows after fetch, skipping", symbol, len(df))
            return {"error": f"Not enough data ({len(df)} rows) even after fetching"}

    results = {}
    for horizon in ["t1", "t3", "t5"]:
        try:
            result = train(symbol, horizon)
            results[horizon] = result
            if "error" in result:
                logger.warning("Train %s/%s failed: %s", symbol, horizon, result["error"])
            else:
                logger.info("Trained %s/%s: accuracy=%.4f", symbol, horizon, result["accuracy"])
        except Exception:
            logger.exception("Train error %s/%s", symbol, horizon)
            results[horizon] = {"error": "training exception"}
    return results


@router.post("/fetch")
def trigger_fetch(req: FetchRequest, background_tasks: BackgroundTasks):
    """Trigger Tushare data fetch for a symbol (incremental by default)."""
    symbol = req.symbol.upper()
    today = datetime.now(timezone.utc).date()

    # If no explicit start, do incremental: fetch from last_news_fetch + 1 day
    start = req.start
    end = req.end or today.isoformat()
    if not start:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT last_news_fetch FROM tickers WHERE symbol = %s",
                    (symbol,),
                )
                row = cur.fetchone()
                if row and row.get("last_news_fetch"):
                    last = row["last_news_fetch"]
                    # Normalize to date string for comparison
                    last_str = str(last)[:10]
                    if last_str >= end:
                        cur.execute(
                            """SELECT COUNT(*) AS c
                               FROM news_aligned na
                               LEFT JOIN layer0_results l0
                                 ON l0.news_id = na.news_id AND l0.symbol = na.symbol
                               LEFT JOIN layer1_results l1
                                 ON l1.news_id = na.news_id AND l1.symbol = na.symbol
                               WHERE na.symbol = %s
                                 AND COALESCE(l0.passed, 1) = 1
                                 AND l1.news_id IS NULL""",
                            (symbol,),
                        )
                        pending_row = cur.fetchone()
                        pending = int((pending_row or {}).get("c") or 0)
                        if pending > 0:
                            logger.info("Symbol %s up-to-date but has %d pending Layer1 items, processing...", symbol, pending)
                            background_tasks.add_task(_do_process_only, symbol)
                            return {"symbol": symbol, "status": "processing_started", "pending": pending}
                        return {"symbol": symbol, "status": "up_to_date"}
                    start = (datetime.fromisoformat(last_str) + timedelta(days=1)).date().isoformat()
                else:
                    start = (today - timedelta(days=2 * 366)).isoformat()
        finally:
            conn.close()

    logger.info("Triggering fetch for %s (%s ~ %s)", symbol, start, end)
    background_tasks.add_task(_do_fetch, symbol, start, end)
    return {"symbol": symbol, "status": "fetch_started", "start": start, "end": end}


@router.get("/status/{symbol}")
def get_pipeline_status(symbol: str):
    """Get fetch/process progress for a symbol."""
    symbol = symbol.upper()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT last_ohlc_fetch, last_news_fetch FROM tickers WHERE symbol = %s",
                (symbol,),
            )
            ticker = cur.fetchone() or {}

            cur.execute("SELECT COUNT(*) AS c FROM ohlc WHERE symbol = %s", (symbol,))
            ohlc_count = int((cur.fetchone() or {}).get("c") or 0)

            cur.execute(
                "SELECT COUNT(*) AS c FROM news_ticker WHERE symbol = %s",
                (symbol,),
            )
            raw_news_count = int((cur.fetchone() or {}).get("c") or 0)

            cur.execute(
                "SELECT COUNT(*) AS c FROM news_aligned WHERE symbol = %s",
                (symbol,),
            )
            aligned_count = int((cur.fetchone() or {}).get("c") or 0)

            cur.execute(
                """SELECT COUNT(*) AS c
                   FROM news_ticker nt
                   WHERE nt.symbol = %s
                     AND NOT EXISTS (
                        SELECT 1
                        FROM news_aligned na
                        WHERE na.news_id = nt.news_id AND na.symbol = nt.symbol
                     )""",
                (symbol,),
            )
            pending_alignment = int((cur.fetchone() or {}).get("c") or 0)

            cur.execute(
                "SELECT COUNT(*) AS c FROM layer1_results WHERE symbol = %s",
                (symbol,),
            )
            layer1_count = int((cur.fetchone() or {}).get("c") or 0)

            cur.execute(
                """SELECT COUNT(*) AS c
                   FROM news_aligned na
                   LEFT JOIN layer0_results l0
                     ON l0.news_id = na.news_id AND l0.symbol = na.symbol
                   LEFT JOIN layer1_results l1
                     ON l1.news_id = na.news_id AND l1.symbol = na.symbol
                   WHERE na.symbol = %s
                     AND COALESCE(l0.passed, 1) = 1
                     AND l1.news_id IS NULL""",
                (symbol,),
            )
            pending_layer1 = int((cur.fetchone() or {}).get("c") or 0)
    finally:
        conn.close()

    last_ohlc = ticker.get("last_ohlc_fetch")
    last_news = ticker.get("last_news_fetch")

    return {
        "symbol": symbol,
        "last_ohlc_fetch": str(last_ohlc)[:10] if last_ohlc else None,
        "last_news_fetch": str(last_news)[:10] if last_news else None,
        "ohlc_count": ohlc_count,
        "raw_news_count": raw_news_count,
        "aligned_count": aligned_count,
        "pending_alignment": pending_alignment,
        "layer1_count": layer1_count,
        "pending_layer1": pending_layer1,
        "deepseek_enabled": bool(settings.deepseek_api_key),
    }


def _run_post_fetch_pipeline(symbol: str, auto_train: bool = True):
    # Run alignment
    logger.info("Running alignment for %s...", symbol)
    align_result = align_news_for_symbol(symbol)
    logger.info("Alignment done for %s: %s", symbol, align_result)

    # Run Layer0 + Layer1 so sentiment features become available automatically
    try:
        l0_stats = run_layer0(symbol)
        logger.info("Layer0 done for %s: %s", symbol, l0_stats)
    except Exception:
        logger.exception("Layer0 error for %s", symbol)

    if settings.deepseek_api_key:
        try:
            l1_stats = run_layer1(symbol, max_articles=1000)
            logger.info("Layer1 done for %s: %s", symbol, l1_stats)
        except Exception:
            logger.exception("Layer1 error for %s", symbol)
    else:
        logger.warning("Layer1 skipped for %s: deepseek_api_key is empty", symbol)

    # Auto-train model if enough data
    if auto_train:
        try:
            from backend.ml.model import train
            for horizon in ["t1", "t3", "t5"]:
                result = train(symbol, horizon)
                if "error" in result:
                    logger.info("Skip training %s/%s: %s", symbol, horizon, result["error"])
                else:
                    logger.info("Trained %s/%s: accuracy=%.4f", symbol, horizon, result["accuracy"])
        except Exception:
            logger.exception("Auto-train error for %s", symbol)


def _do_process_only(symbol: str):
    """Run alignment + Layer0/1 (+ optional training) without fetching remote data."""
    try:
        _run_post_fetch_pipeline(symbol, auto_train=True)
        logger.info("Process-only pipeline complete for %s", symbol)
    except Exception:
        logger.exception("Process-only pipeline error for %s", symbol)


def _do_fetch(symbol: str, start: str, end: str, auto_train: bool = True):
    """Background fetch of OHLC + news data."""
    try:
        # Ensure ticker exists in DB first
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT IGNORE INTO tickers (symbol, name) VALUES (%s, %s)",
                    (symbol, symbol),
                )
            conn.commit()
        finally:
            conn.close()

        # OHLC
        logger.info("Fetching OHLC for %s (%s ~ %s)...", symbol, start, end)
        ohlc_rows = fetch_ohlc(symbol, start, end)
        logger.info("Fetched %d OHLC rows for %s", len(ohlc_rows), symbol)

        conn = get_conn()
        try:
            with conn.cursor() as cur:
                for row in ohlc_rows:
                    cur.execute(
                        """INSERT IGNORE INTO ohlc
                           (symbol, `date`, `open`, high, low, `close`, volume, vwap, transactions)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (symbol, row["date"], row["open"], row["high"], row["low"],
                         row["close"], row["volume"], row["vwap"], row["transactions"]),
                    )
                cur.execute(
                    "UPDATE tickers SET last_ohlc_fetch = %s WHERE symbol = %s",
                    (end, symbol),
                )
            conn.commit()

            # News - 通过新浪财经爬取个股新闻
            logger.info("Fetching news for %s (%s ~ %s)...", symbol, start, end)
            try:
                articles = fetch_news(symbol, start=start, end=end, max_items=500)
                logger.info("Fetched %d news articles for %s", len(articles), symbol)
                with conn.cursor() as cur:
                    for art in articles:
                        news_id = art.get("id")
                        if not news_id:
                            continue
                        tickers = art.get("tickers") or []
                        cur.execute(
                            """INSERT IGNORE INTO news_raw
                               (id, title, description, publisher, author,
                                published_utc, article_url, amp_url, tickers_json, insights_json)
                               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                            (news_id, art.get("title"), art.get("description"),
                             art.get("publisher"), art.get("author"), art.get("published_utc"),
                             art.get("article_url"), art.get("amp_url"),
                             json.dumps(tickers),
                             json.dumps(art.get("insights")) if art.get("insights") else None),
                        )
                        cur.execute(
                            "INSERT IGNORE INTO news_ticker (news_id, symbol) VALUES (%s, %s)",
                            (news_id, symbol),
                        )
                conn.commit()
                # Only update last_news_fetch after successful news commit
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE tickers SET last_news_fetch = %s WHERE symbol = %s",
                        (end, symbol),
                    )
                conn.commit()
            except Exception:
                logger.exception("News fetch error for symbol=%s", symbol)
                conn.rollback()
        finally:
            conn.close()

        _run_post_fetch_pipeline(symbol, auto_train=auto_train)

        logger.info("Fetch pipeline complete for %s", symbol)
    except Exception:
        logger.exception("Fetch error for %s", symbol)


@router.post("/process")
def trigger_process(req: ProcessRequest):
    """Run Layer 0 filter, then submit Layer 1 for remaining articles."""
    symbol = req.symbol.upper()

    # Step 1: Alignment
    align_result = align_news_for_symbol(symbol)

    # Step 2: Layer 0
    l0_stats = run_layer0(symbol)

    # Step 3: Run Layer 1 (50 articles per API call)
    l1_stats = run_layer1(symbol, max_articles=req.batch_size)

    return {
        "symbol": symbol,
        "alignment": align_result,
        "layer0": l0_stats,
        "layer1": l1_stats,
    }
