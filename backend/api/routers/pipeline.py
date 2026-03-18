import logging

from fastapi import APIRouter, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

from backend.database import get_conn
from backend.tushare.client import fetch_ohlc, fetch_news  # noqa: F401
from backend.pipeline.layer0 import run_layer0
from backend.pipeline.layer1 import get_pending_articles, run_layer1
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
    """Train XGBoost models (t1 + t5) for a symbol."""
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
        _do_fetch(symbol, start, end)

        # Re-check after fetch
        df = build_features(symbol)
        if df.empty or len(df) < 60:
            logger.warning("Train %s: still only %d rows after fetch, skipping", symbol, len(df))
            return {"error": f"Not enough data ({len(df)} rows) even after fetching"}

    results = {}
    for horizon in ["t1", "t5"]:
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
                        return {"symbol": symbol, "status": "up_to_date"}
                    start = (datetime.fromisoformat(last_str) + timedelta(days=1)).date().isoformat()
                else:
                    start = (today - timedelta(days=2 * 366)).isoformat()
        finally:
            conn.close()

    logger.info("Triggering fetch for %s (%s ~ %s)", symbol, start, end)
    background_tasks.add_task(_do_fetch, symbol, start, end)
    return {"symbol": symbol, "status": "fetch_started", "start": start, "end": end}


def _do_fetch(symbol: str, start: str, end: str):
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

        # Run alignment
        logger.info("Running alignment for %s...", symbol)
        align_news_for_symbol(symbol)

        # Auto-train model if enough data
        try:
            from backend.ml.model import train
            for horizon in ["t1", "t5"]:
                result = train(symbol, horizon)
                if "error" in result:
                    logger.info("Skip training %s/%s: %s", symbol, horizon, result["error"])
                else:
                    logger.info("Trained %s/%s: accuracy=%.4f", symbol, horizon, result["accuracy"])
        except Exception:
            logger.exception("Auto-train error for %s", symbol)

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
