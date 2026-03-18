"""News-to-trading-day alignment with forward return calculation.

Maps published_utc to nearest trading day and computes T+0/1/3/5/10 returns.
"""

from datetime import datetime, timedelta
from typing import Optional

from backend.database import get_conn


def align_news_for_symbol(symbol: str) -> dict:
    """Align all unaligned news for a symbol to trading days with forward returns."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Load OHLC dates and closes
            cur.execute(
                "SELECT `date`, `close` FROM ohlc WHERE symbol = %s ORDER BY `date` ASC",
                (symbol,),
            )
            ohlc_rows = cur.fetchall()

            if not ohlc_rows:
                return {"error": "No OHLC data", "aligned": 0}

            dates = [r["date"] for r in ohlc_rows]
            idx = {d: i for i, d in enumerate(dates)}
            close = {r["date"]: float(r["close"]) for r in ohlc_rows}

            # Get news not yet aligned for this symbol
            cur.execute(
                """SELECT nr.id, nr.published_utc
                   FROM news_raw nr
                   JOIN news_ticker nt ON nr.id = nt.news_id
                   WHERE nt.symbol = %s
                   AND nr.id NOT IN (
                       SELECT news_id FROM news_aligned WHERE symbol = %s
                   )""",
                (symbol, symbol),
            )
            news_rows = cur.fetchall()

            aligned_count = 0
            horizons = (1, 3, 5, 10)

            for row in news_rows:
                pu = row["published_utc"]
                d0 = _to_iso_date(pu)
                if not d0:
                    continue
                trade_date = _shift_to_trade_day(d0, idx)
                if not trade_date:
                    continue

                i = idx[trade_date]
                prev_d = dates[i - 1] if i > 0 else None

                ret_t0 = _pct(close.get(prev_d), close.get(trade_date)) if prev_d else None

                returns = {}
                for h in horizons:
                    j = i + h
                    if 0 <= j < len(dates):
                        returns[f"ret_t{h}"] = _pct(close.get(trade_date), close.get(dates[j]))
                    else:
                        returns[f"ret_t{h}"] = None

                cur.execute(
                    """INSERT IGNORE INTO news_aligned
                       (news_id, symbol, trade_date, published_utc, ret_t0, ret_t1, ret_t3, ret_t5, ret_t10)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (
                        row["id"],
                        symbol,
                        trade_date,
                        pu,
                        ret_t0,
                        returns.get("ret_t1"),
                        returns.get("ret_t3"),
                        returns.get("ret_t5"),
                        returns.get("ret_t10"),
                    ),
                )
                aligned_count += 1

        conn.commit()
    finally:
        conn.close()
    return {"aligned": aligned_count, "total_news": len(news_rows)}


def _to_iso_date(published_utc: Optional[str]) -> Optional[str]:
    if not published_utc:
        return None
    try:
        # 处理多种日期格式
        pub = published_utc.strip()
        if "T" in pub or "+" in pub or pub.endswith("Z"):
            return (
                datetime.fromisoformat(pub.replace("Z", "+00:00"))
                .date()
                .isoformat()
            )
        # Tushare 格式: "2024-01-15 09:30:00"
        if " " in pub:
            return pub.split(" ")[0]
        return pub[:10] if len(pub) >= 10 else None
    except (ValueError, AttributeError):
        return None


def _shift_to_trade_day(d: str, idx: dict) -> Optional[str]:
    dt = datetime.fromisoformat(d).date()
    for _ in range(7):
        ds = dt.isoformat()
        if ds in idx:
            return ds
        dt += timedelta(days=1)
    return None


def _pct(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None or a == 0:
        return None
    return (b - a) / a
