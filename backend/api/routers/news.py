from fastapi import APIRouter, Query
from typing import Optional

from backend.database import get_conn

router = APIRouter()


RETURN_FIELDS = ("ret_t0", "ret_t1", "ret_t3", "ret_t5", "ret_t10")


def _percent_or_none(value):
    if value is None:
        return None
    return round(float(value) * 100, 2)


def _normalize_return_fields(row: dict) -> dict:
    normalized = dict(row)
    for field in RETURN_FIELDS:
        if field in normalized:
            normalized[field] = _percent_or_none(normalized[field])
    return normalized


@router.get("/{symbol}")
def get_news_for_date(
    symbol: str,
    date: Optional[str] = None,
):
    """Get news for a symbol, optionally filtered to a specific trading day."""
    conn = get_conn()
    symbol = symbol.upper()

    try:
        with conn.cursor() as cur:
            if date:
                cur.execute(
                    """SELECT na.news_id, na.trade_date, na.published_utc,
                              na.ret_t0, na.ret_t1, na.ret_t3, na.ret_t5, na.ret_t10,
                              nr.title, nr.description, nr.publisher, nr.article_url,
                              l1.relevance, l1.key_discussion, l1.chinese_summary,
                              l1.sentiment, l1.reason_growth, l1.reason_decrease
                       FROM news_aligned na
                       JOIN news_raw nr ON na.news_id = nr.id
                       LEFT JOIN layer1_results l1 ON na.news_id = l1.news_id AND l1.symbol = %s
                       WHERE na.symbol = %s AND na.trade_date = %s
                       ORDER BY na.published_utc DESC""",
                    (symbol, symbol, date),
                )
            else:
                cur.execute(
                    """SELECT na.news_id, na.trade_date, na.published_utc,
                              na.ret_t0, na.ret_t1, na.ret_t3, na.ret_t5, na.ret_t10,
                              nr.title, nr.description, nr.publisher, nr.article_url,
                              l1.relevance, l1.key_discussion, l1.chinese_summary,
                              l1.sentiment, l1.reason_growth, l1.reason_decrease
                       FROM news_aligned na
                       JOIN news_raw nr ON na.news_id = nr.id
                       LEFT JOIN layer1_results l1 ON na.news_id = l1.news_id AND l1.symbol = %s
                       WHERE na.symbol = %s
                       ORDER BY na.published_utc DESC
                       LIMIT 100""",
                    (symbol, symbol),
                )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [_normalize_return_fields(row) for row in rows]


@router.get("/{symbol}/range")
def get_news_for_range(
    symbol: str,
    start: str = Query(..., description="Start date YYYY-MM-DD"),
    end: str = Query(..., description="End date YYYY-MM-DD"),
):
    """Get news within a date range, with top bullish/bearish articles."""
    conn = get_conn()
    symbol = symbol.upper()

    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT na.news_id, na.trade_date, na.published_utc,
                          na.ret_t0, na.ret_t1, na.ret_t3, na.ret_t5, na.ret_t10,
                          nr.title, nr.description, nr.publisher, nr.article_url,
                          l1.relevance, l1.key_discussion, l1.chinese_summary,
                          l1.sentiment, l1.reason_growth, l1.reason_decrease
                   FROM news_aligned na
                   JOIN news_raw nr ON na.news_id = nr.id
                   LEFT JOIN layer1_results l1 ON na.news_id = l1.news_id AND l1.symbol = %s
                   WHERE na.symbol = %s AND na.trade_date BETWEEN %s AND %s
                   ORDER BY na.published_utc DESC""",
                (symbol, symbol, start, end),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    articles = [_normalize_return_fields(row) for row in rows]

    top_bullish = sorted(
        [a for a in articles if a.get("sentiment") == "positive" and a.get("ret_t0") is not None],
        key=lambda a: a["ret_t0"],
        reverse=True,
    )[:5]

    top_bearish = sorted(
        [a for a in articles if a.get("sentiment") == "negative" and a.get("ret_t0") is not None],
        key=lambda a: a["ret_t0"],
    )[:5]

    return {
        "total": len(articles),
        "date_range": [start, end],
        "articles": articles,
        "top_bullish": top_bullish,
        "top_bearish": top_bearish,
    }


@router.get("/{symbol}/particles")
def get_news_particles(symbol: str):
    """Return lightweight per-article data for chart particle visualization."""
    conn = get_conn()
    symbol = symbol.upper()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT na.news_id, na.trade_date, na.ret_t1,
                          nr.title,
                          l1.sentiment, l1.relevance
                   FROM news_aligned na
                   JOIN news_raw nr ON na.news_id = nr.id
                   LEFT JOIN layer1_results l1 ON na.news_id = l1.news_id AND l1.symbol = %s
                   WHERE na.symbol = %s
                   ORDER BY na.trade_date ASC, l1.relevance DESC""",
                (symbol, symbol),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return [
        {
            "id": r["news_id"],
            "d": r["trade_date"],
            "s": r["sentiment"],
            "r": r["relevance"],
            "t": (r["title"] or "")[:80],
            "rt1": _percent_or_none(r["ret_t1"]),
        }
        for r in rows
    ]


@router.get("/{symbol}/categories")
def get_news_categories(symbol: str):
    """Categorize ALL news for a symbol by topic using keyword matching."""
    conn = get_conn()
    symbol = symbol.upper()

    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT na.news_id,
                          nr.title,
                          l1.key_discussion,
                          l1.reason_growth,
                          l1.reason_decrease,
                          l1.sentiment
                   FROM news_aligned na
                   JOIN news_raw nr ON na.news_id = nr.id
                   LEFT JOIN layer1_results l1 ON na.news_id = l1.news_id AND l1.symbol = %s
                   WHERE na.symbol = %s
                   ORDER BY na.trade_date DESC""",
                (symbol, symbol),
            )
            rows = cur.fetchall()
    finally:
        conn.close()

    CATEGORY_KEYWORDS = {
        "market": [
            "大盘", "市场", "行情", "指数", "A股", "沪深", "上证", "深证",
            "涨停", "跌停", "放量", "缩量", "牛市", "熊市", "震荡",
        ],
        "policy": [
            "政策", "监管", "央行", "利率", "降准", "降息", "财政",
            "国务院", "证监会", "银保监", "税收", "关税", "制裁",
        ],
        "earnings": [
            "业绩", "营收", "利润", "财报", "年报", "季报", "中报",
            "增长", "亏损", "预增", "预减", "快报", "分红",
        ],
        "product_tech": [
            "产品", "技术", "芯片", "新能源", "人工智能", "AI",
            "5G", "半导体", "创新", "研发", "专利", "自动驾驶",
        ],
        "competition": [
            "竞争", "对手", "市场份额", "超越", "领先", "行业格局",
        ],
        "management": [
            "董事长", "总经理", "高管", "辞职", "裁员", "重组",
            "管理层", "人事变动", "任命", "董事会",
        ],
    }

    categories = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        categories[cat] = {
            "label": cat,
            "count": 0,
            "article_ids": [],
            "positive_ids": [],
            "negative_ids": [],
            "neutral_ids": [],
        }

    total = len(rows)
    for r in rows:
        text = " ".join([
            (r["title"] or ""),
            (r["key_discussion"] or ""),
            (r["reason_growth"] or ""),
            (r["reason_decrease"] or ""),
        ]).lower()
        sentiment = r["sentiment"]
        for cat, keywords in CATEGORY_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                categories[cat]["count"] += 1
                categories[cat]["article_ids"].append(r["news_id"])
                if sentiment == "positive":
                    categories[cat]["positive_ids"].append(r["news_id"])
                elif sentiment == "negative":
                    categories[cat]["negative_ids"].append(r["news_id"])
                else:
                    categories[cat]["neutral_ids"].append(r["news_id"])

    return {"categories": categories, "total": total}


@router.get("/{symbol}/timeline")
def get_news_timeline(symbol: str):
    """Get dates that have news for a symbol (used for chart markers)."""
    conn = get_conn()
    symbol = symbol.upper()

    try:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT trade_date, COUNT(*) as news_count,
                          SUM(CASE WHEN l1.relevance = 'relevant' THEN 1 ELSE 0 END) as relevant_count
                   FROM news_aligned na
                   LEFT JOIN layer1_results l1 ON na.news_id = l1.news_id AND l1.symbol = na.symbol
                   WHERE na.symbol = %s
                   GROUP BY trade_date
                   ORDER BY trade_date ASC""",
                (symbol,),
            )
            rows = cur.fetchall()
    finally:
        conn.close()
    return list(rows)
