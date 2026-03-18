import logging

from fastapi import APIRouter, Query, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

from backend.database import get_conn
from backend.tushare.client import fetch_ohlc, fetch_news, search_tickers

router = APIRouter()


class AddTickerRequest(BaseModel):
    symbol: str
    name: Optional[str] = None


@router.get("")
def list_tickers():
    """List all tracked tickers."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM tickers ORDER BY symbol")
            rows = cur.fetchall()
    finally:
        conn.close()
    return list(rows)


@router.get("/search")
def search(q: str = Query(..., min_length=1)):
    """Fuzzy search tickers via Tushare."""
    # First check local DB
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT symbol, name, sector FROM tickers WHERE symbol LIKE %s OR name LIKE %s LIMIT 10",
                (f"%{q}%", f"%{q}%"),
            )
            local = cur.fetchall()
    finally:
        conn.close()

    results = list(local)

    # If few local results, also search Tushare
    if len(results) < 5:
        try:
            remote = search_tickers(q, limit=10)
            seen = {r["symbol"] for r in results}
            for r in remote:
                if r["symbol"] not in seen:
                    results.append(r)
        except Exception:
            logger.debug("Tushare search failed for query=%s", q)

    return results


@router.get("/{symbol}/ohlc")
def get_ohlc(
    symbol: str,
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    """Get OHLC data for a symbol."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            query = "SELECT * FROM ohlc WHERE symbol = %s"
            params: list = [symbol.upper()]

            if start:
                query += " AND `date` >= %s"
                params.append(start)
            if end:
                query += " AND `date` <= %s"
                params.append(end)

            query += " ORDER BY `date` ASC"
            cur.execute(query, params)
            rows = cur.fetchall()
    finally:
        conn.close()

    if not rows:
        return []

    return list(rows)


@router.post("")
def add_ticker(req: AddTickerRequest, background_tasks: BackgroundTasks):
    """Add a new ticker and trigger background data fetch."""
    symbol = req.symbol.upper()
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT IGNORE INTO tickers (symbol, name) VALUES (%s, %s)",
                (symbol, req.name or symbol),
            )
        conn.commit()
    finally:
        conn.close()

    background_tasks.add_task(_fetch_ticker_data, symbol)
    return {"symbol": symbol, "status": "added", "message": "Data fetch started in background"}


def _fetch_ticker_data(symbol: str):
    """Background task to fetch OHLC and news for a ticker."""
    import json

    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=2 * 366)).isoformat()
    end = today.isoformat()

    try:
        # Fetch OHLC
        ohlc_rows = fetch_ohlc(symbol, start, end)
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

            # Fetch news - 通过新浪财经爬取个股新闻
            try:
                articles = fetch_news(symbol, start=start, end=end, max_items=500)
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
                logger.exception("Error fetching news for %s", symbol)
                conn.rollback()
        finally:
            conn.close()
    except Exception:
        logger.exception("Error fetching data for %s", symbol)
