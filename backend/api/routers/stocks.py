import logging

from fastapi import APIRouter, BackgroundTasks, Query
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta, timezone

from backend.database import get_conn
from backend.tushare.client import search_tickers

logger = logging.getLogger(__name__)

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

    return list(rows) if rows else []


@router.post("")
def add_ticker(req: AddTickerRequest, background_tasks: BackgroundTasks):
    """Add a new ticker and trigger the full fetch+process pipeline."""
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

    today = datetime.now(timezone.utc).date()
    start = (today - timedelta(days=2 * 366)).isoformat()
    end = today.isoformat()

    from backend.api.routers.pipeline import _do_fetch

    background_tasks.add_task(_do_fetch, symbol, start, end, True)
    return {
        "symbol": symbol,
        "status": "added",
        "message": "Fetch + process started in background",
        "start": start,
        "end": end,
    }
