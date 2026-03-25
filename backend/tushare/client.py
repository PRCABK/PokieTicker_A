"""Tushare Pro 数据客户端。

替代原 Polygon.io 客户端，提供A股日线数据、财经新闻和股票搜索功能。
"""

import hashlib
import time
from datetime import datetime, timedelta
from threading import Lock
from typing import Any, Dict, List, Optional

import tushare as ts

from backend.config import settings

# 初始化 Tushare Pro API
_pro: Optional[ts.pro_api] = None
_stock_basic_records_cache: Optional[list[dict[str, str]]] = None
_stock_basic_records_fetched_at = 0.0
_stock_basic_cache_lock = Lock()
STOCK_BASIC_CACHE_TTL_SECONDS = 6 * 60 * 60


def _get_pro() -> ts.pro_api:
    global _pro
    if _pro is None:
        _pro = ts.pro_api(settings.tushare_token)
    return _pro


def _normalize_stock_basic_row(row: Dict[str, Any]) -> Dict[str, str]:
    return {
        "ts_code": str(row.get("ts_code") or ""),
        "symbol": str(row.get("symbol") or ""),
        "name": str(row.get("name") or ""),
        "industry": str(row.get("industry") or ""),
    }


def _fetch_stock_basic_records() -> Optional[List[Dict[str, str]]]:
    pro = _get_pro()

    try:
        df = pro.stock_basic(
            exchange="",
            list_status="L",
            fields="ts_code,symbol,name,area,industry,list_date",
        )
    except Exception as e:
        print(f"  Tushare stock_basic error: {e}")
        return None

    if df is None or df.empty:
        return []

    return [_normalize_stock_basic_row(row) for row in df.to_dict("records")]


def _get_stock_basic_records(force_refresh: bool = False) -> List[Dict[str, str]]:
    global _stock_basic_records_cache, _stock_basic_records_fetched_at

    now = time.monotonic()
    if (
        not force_refresh
        and _stock_basic_records_cache is not None
        and now - _stock_basic_records_fetched_at < STOCK_BASIC_CACHE_TTL_SECONDS
    ):
        return [row.copy() for row in _stock_basic_records_cache]

    with _stock_basic_cache_lock:
        now = time.monotonic()
        if (
            not force_refresh
            and _stock_basic_records_cache is not None
            and now - _stock_basic_records_fetched_at < STOCK_BASIC_CACHE_TTL_SECONDS
        ):
            return [row.copy() for row in _stock_basic_records_cache]

        cached_records = _stock_basic_records_cache
        records = _fetch_stock_basic_records()
        if records is None:
            return [row.copy() for row in cached_records] if cached_records is not None else []

        if records or cached_records is None:
            _stock_basic_records_cache = records
            _stock_basic_records_fetched_at = now
            return [row.copy() for row in records]

        return [row.copy() for row in cached_records]


def _match_stock_basic_records(records: List[Dict[str, str]], query: str, limit: int) -> List[Dict[str, str]]:
    q_upper = query.upper().strip()
    q_lower = query.lower().strip()
    matched: List[Dict[str, str]] = []

    for row in records:
        ts_code = row["ts_code"].upper()
        symbol = row["symbol"].upper()
        name = row["name"].lower()
        if q_upper in ts_code or q_upper in symbol or q_lower in name:
            matched.append({
                "symbol": row["ts_code"],
                "name": row["name"],
                "sector": row["industry"],
            })
            if len(matched) >= limit:
                break

    return matched


def _safe_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def fetch_ohlc(ts_code: str, start: str, end: str) -> List[Dict[str, Any]]:
    """获取A股日线行情数据。

    Args:
        ts_code: Tushare 股票代码，如 '000001.SZ'
        start: 开始日期 'YYYY-MM-DD'
        end: 结束日期 'YYYY-MM-DD'

    Returns:
        日线数据列表，字段与原 ohlc 表一致。
    """
    pro = _get_pro()
    # Tushare 日期格式: YYYYMMDD
    start_ts = start.replace("-", "")
    end_ts = end.replace("-", "")

    df = pro.daily(ts_code=ts_code, start_date=start_ts, end_date=end_ts)
    if df is None or df.empty:
        return []

    daily_basic_by_date: Dict[str, Dict[str, Any]] = {}
    try:
        basic_df = pro.daily_basic(
            ts_code=ts_code,
            start_date=start_ts,
            end_date=end_ts,
            fields="ts_code,trade_date,turnover_rate,circ_mv,total_mv",
        )
        if basic_df is not None and not basic_df.empty:
            daily_basic_by_date = {
                str(row.get("trade_date") or ""): row
                for row in basic_df.to_dict("records")
            }
    except Exception:
        daily_basic_by_date = {}

    daily_rows = sorted(
        df.to_dict("records"),
        key=lambda row: str(row.get("trade_date") or ""),
    )

    rows = []
    for r in daily_rows:
        trade_date = str(r.get("trade_date") or "")
        basic_row = daily_basic_by_date.get(trade_date, {})
        if len(trade_date) != 8:
            continue
        d = f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}"
        rows.append({
            "date": d,
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": float(r["vol"]),         # 成交量(手)
            "vwap": float(r["amount"]),         # 成交额(千元)，复用vwap字段
            "turnover_rate": _safe_float(basic_row.get("turnover_rate")),
            "circ_mv": _safe_float(basic_row.get("circ_mv")),
            "total_mv": _safe_float(basic_row.get("total_mv")),
            "transactions": None,
        })
    return rows


def fetch_index_ohlc(ts_code: str, start: str, end: str) -> List[Dict[str, Any]]:
    """获取A股指数日线数据，用于超额收益基准。"""
    pro = _get_pro()
    start_ts = start.replace("-", "")
    end_ts = end.replace("-", "")

    df = pro.index_daily(ts_code=ts_code, start_date=start_ts, end_date=end_ts)
    if df is None or df.empty:
        return []

    daily_rows = sorted(
        df.to_dict("records"),
        key=lambda row: str(row.get("trade_date") or ""),
    )

    rows = []
    for r in daily_rows:
        trade_date = str(r.get("trade_date") or "")
        if len(trade_date) != 8:
            continue
        rows.append({
            "date": f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}",
            "open": float(r["open"]),
            "high": float(r["high"]),
            "low": float(r["low"]),
            "close": float(r["close"]),
            "volume": _safe_float(r.get("vol")) or 0.0,
            "amount": _safe_float(r.get("amount")) or 0.0,
        })
    return rows


def _ts_code_to_eastmoney(ts_code: str) -> str:
    """将 Tushare 代码转为东方财富 mTypeAndCode 格式。

    000001.SZ -> 0.000001  (深圳=0)
    600519.SH -> 1.600519  (上海=1)
    """
    parts = ts_code.split(".")
    if len(parts) == 2:
        code, exchange = parts
        prefix = "1" if exchange.upper() == "SH" else "0"
        return f"{prefix}.{code}"
    code = ts_code.strip()
    if code.startswith("6") or code.startswith("9"):
        return f"1.{code}"
    return f"0.{code}"


def fetch_news(
    ts_code: str,
    start: str = "",
    end: str = "",
    max_items: int = 200,
) -> List[Dict[str, Any]]:
    """获取个股新闻（通过东方财富资讯接口）。

    Args:
        ts_code: 股票代码，如 '000001.SZ'
        start: 开始日期 'YYYY-MM-DD'
        end: 结束日期 'YYYY-MM-DD'
        max_items: 最大获取条数

    Returns:
        新闻列表，字段适配原 news_raw 表结构。
    """
    import logging
    import requests as _requests
    logger = logging.getLogger(__name__)

    m_type_and_code = _ts_code_to_eastmoney(ts_code)
    start_date = datetime.strptime(start, "%Y-%m-%d") if start else None
    end_date = datetime.strptime(end, "%Y-%m-%d") if end else None

    articles = []
    page_index = 1
    page_size = 100  # 东方财富单页最大100条

    while len(articles) < max_items:
        try:
            resp = _requests.get(
                "https://np-listapi.eastmoney.com/comm/wap/getListInfo",
                params={
                    "client": "wap",
                    "type": 1,
                    "mTypeAndCode": m_type_and_code,
                    "pageSize": page_size,
                    "pageIndex": page_index,
                    "param": "list",
                    "name": "zixunlist",
                },
                timeout=15,
            )
            data = resp.json()
        except Exception as e:
            logger.warning("eastmoney news API error for %s: %s", ts_code, e)
            break

        items = (data.get("data") or {}).get("list") or []
        if not items:
            break

        for item in items:
            title = (item.get("Art_Title") or "").strip()
            pub_time = (item.get("Art_ShowTime") or "").strip()
            source = (item.get("Art_MediaName") or "").strip()
            url = (item.get("Art_Url") or "").strip()

            if not title or not pub_time:
                continue

            # 日期过滤
            try:
                article_date = datetime.strptime(pub_time[:10], "%Y-%m-%d")
            except ValueError:
                continue

            if start_date and article_date < start_date:
                continue
            if end_date and article_date > end_date:
                continue

            news_id = hashlib.md5(
                f"{title}_{pub_time}_{url}".encode("utf-8")
            ).hexdigest()

            articles.append({
                "id": news_id,
                "title": title,
                "description": title,  # 列表接口无正文，用标题
                "publisher": source or "东方财富",
                "author": "",
                "published_utc": pub_time,
                "article_url": url,
                "amp_url": "",
                "tickers": [ts_code],
                "insights": None,
            })

            if len(articles) >= max_items:
                break

        # 如果本页返回条数少于请求的，说明没有更多了
        if len(items) < page_size:
            break
        page_index += 1

    logger.info("eastmoney fetched %d news for %s", len(articles), ts_code)
    return articles


def search_tickers(query: str, limit: int = 20) -> List[Dict[str, str]]:
    """搜索A股股票代码。

    Args:
        query: 搜索关键词（代码或名称）
        limit: 最大返回数量

    Returns:
        匹配的股票列表。
    """
    records = _get_stock_basic_records()
    if not records:
        return []

    matched = _match_stock_basic_records(records, query, limit)
    if matched:
        return matched

    refreshed_records = _get_stock_basic_records(force_refresh=True)
    if refreshed_records == records:
        return []
    return _match_stock_basic_records(refreshed_records, query, limit)


def get_ticker_name(ts_code: str) -> str:
    """根据股票代码获取名称。"""
    target = ts_code.upper()
    for force_refresh in (False, True):
        for row in _get_stock_basic_records(force_refresh=force_refresh):
            if row["ts_code"].upper() == target:
                return row["name"]

    pro = _get_pro()
    try:
        df = pro.stock_basic(ts_code=ts_code, fields="ts_code,name")
        if df is not None and not df.empty:
            return str(df.iloc[0]["name"])
    except Exception:
        pass
    return ""
