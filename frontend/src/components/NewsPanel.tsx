import { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';

interface NewsItem {
  news_id: string;
  trade_date: string;
  published_utc: string;
  title: string;
  description: string;
  publisher: string;
  article_url: string;
  image_url: string | null;
  relevance: string | null;
  key_discussion: string | null;
  sentiment: string | null;
  event_type?: string | null;
  event_types?: string[];
  reason_growth: string | null;
  reason_decrease: string | null;
  ret_t0: number | null;
  ret_t1: number | null;
  ret_t3: number | null;
  ret_t5: number | null;
  ret_t10: number | null;
}

interface Props {
  symbol: string;
  refreshKey?: number;
  hoveredDate: string | null;
  onFindSimilar?: (newsId: string) => void;
  highlightedNewsId?: string | null;
  isLocked?: boolean;
  onUnlock?: () => void;
  highlightedCategoryIds?: string[];
  categoryFilterActive?: boolean;
}

function sortBySentiment(items: NewsItem[]): NewsItem[] {
  const order: Record<string, number> = { positive: 0, negative: 1, neutral: 2 };
  return [...items].sort((a, b) => {
    const sa = order[a.sentiment || 'neutral'] ?? 2;
    const sb = order[b.sentiment || 'neutral'] ?? 2;
    return sa - sb;
  });
}

function pct(v: number | null) {
  if (v === null || v === undefined) return '-';
  const color = v > 0 ? '#ef5350' : v < 0 ? '#26a69a' : '#888';
  return <span style={{ color, fontWeight: 600 }}>{v > 0 ? '+' : ''}{v.toFixed(2)}%</span>;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  earnings: '业绩',
  policy: '政策',
  order_contract: '订单',
  product_tech: '产品/技术',
  buyback_increase: '回购/增持',
  reduction_unlock: '减持/解禁',
  mna_restructuring: '并购/重组',
  litigation_penalty: '诉讼/处罚',
  management: '管理层',
  other: '其他',
};

export default function NewsPanel({
  symbol,
  refreshKey,
  hoveredDate,
  onFindSimilar,
  highlightedNewsId,
  isLocked,
  onUnlock,
  highlightedCategoryIds,
  categoryFilterActive,
}: Props) {
  const [fetchState, setFetchState] = useState<{ cacheKey: string | null; news: NewsItem[] }>({
    cacheKey: null,
    news: [],
  });
  const [cache, setCache] = useState<Record<string, NewsItem[]>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const currentCacheKey = symbol && hoveredDate ? `${symbol}_${hoveredDate}_${refreshKey ?? 0}` : null;
  const cachedNews = currentCacheKey ? cache[currentCacheKey] ?? null : null;
  const displayDate = currentCacheKey ? hoveredDate : null;
  const news = useMemo(() => {
    if (!currentCacheKey) return [];
    if (fetchState.cacheKey === currentCacheKey) return fetchState.news;
    return cachedNews ?? [];
  }, [cachedNews, currentCacheKey, fetchState.cacheKey, fetchState.news]);
  const loading = Boolean(currentCacheKey && !cachedNews && fetchState.cacheKey !== currentCacheKey);

  // Debounced fetch on hover
  useEffect(() => {
    if (!currentCacheKey || !hoveredDate) return;
    if (isLocked && fetchState.cacheKey === currentCacheKey) return;
    if (cache[currentCacheKey]) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    let cancelled = false;
    debounceRef.current = setTimeout(() => {
      axios
        .get(`/api/news/${symbol}?date=${hoveredDate}`)
        .then((res) => {
          if (cancelled) return;
          const sorted = sortBySentiment(res.data);
          setCache((prev) => ({ ...prev, [currentCacheKey]: sorted }));
          setFetchState({ cacheKey: currentCacheKey, news: sorted });
        })
        .catch(() => {
          if (cancelled) return;
          setFetchState({ cacheKey: currentCacheKey, news: [] });
        });
    }, 120);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [cache, currentCacheKey, hoveredDate, symbol, isLocked, fetchState.cacheKey]);

  // Auto-scroll to highlighted article
  useEffect(() => {
    if (!highlightedNewsId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-news-id="${highlightedNewsId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlightedNewsId, news]);

  const categorySet = categoryFilterActive ? new Set(highlightedCategoryIds ?? []) : null;
  const filteredNews = categorySet ? news.filter((item) => categorySet.has(item.news_id)) : news;

  if (!displayDate) {
    return (
      <div className="news-panel">
        <div className="news-panel-header">
          <h2>新闻</h2>
        </div>
        <div className="news-empty">点击图表上的圆点查看新闻</div>
      </div>
    );
  }

  return (
    <div className="news-panel">
      <div className="news-panel-header">
        <h2>新闻</h2>
        <span className="news-date-badge">{displayDate}</span>
        <span className="news-count">共 {filteredNews.length} 篇</span>
        {isLocked && (
          <button className="lock-badge" onClick={onUnlock} title="点击解锁">
            已锁定
          </button>
        )}
      </div>

      {loading && news.length === 0 ? (
        <div className="news-empty">加载中...</div>
      ) : news.length === 0 ? (
        <div className="news-empty">这一天没有新闻</div>
      ) : categoryFilterActive && filteredNews.length === 0 ? (
        <div className="news-empty">当前筛选条件下无新闻</div>
      ) : (
        <div className="news-list" ref={listRef}>
          {filteredNews.map((item) => (
            <div
              key={item.news_id}
              data-news-id={item.news_id}
              className={`news-card ${item.sentiment === 'positive' ? 'card-positive' : item.sentiment === 'negative' ? 'card-negative' : 'card-neutral'}${highlightedNewsId === item.news_id ? ' card-highlighted' : ''}`}
            >
              <div className="news-card-top">
                <span className={`sentiment-dot ${item.sentiment || 'neutral'}`} />
                <a href={item.article_url} target="_blank" rel="noreferrer" className="news-title">
                  {item.title}
                </a>
              </div>

              {item.event_types && item.event_types.length > 0 && (
                <div className="returns-chips" style={{ marginBottom: 8, gap: 6 }}>
                  {item.event_types.slice(0, 3).map((eventType) => (
                    <span key={eventType} className="ret-chip">{EVENT_TYPE_LABELS[eventType] ?? eventType}</span>
                  ))}
                </div>
              )}

              {item.image_url && (
                <div className="news-image-wrap">
                  <img
                    src={item.image_url}
                    alt=""
                    className="news-image"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}

              {item.key_discussion && (
                <p className="news-summary">{item.key_discussion}</p>
              )}

              {(item.reason_growth || item.reason_decrease) && (
                <div className="news-reasons">
                  {item.reason_growth && (
                    <div className="reason up">
                      <span className="reason-icon">+</span> {item.reason_growth}
                    </div>
                  )}
                  {item.reason_decrease && (
                    <div className="reason down">
                      <span className="reason-icon">-</span> {item.reason_decrease}
                    </div>
                  )}
                </div>
              )}

              <div className="news-card-footer">
                <span className="news-publisher">{item.publisher}</span>
                <div className="returns-chips">
                  <span className="ret-chip">T+1 {pct(item.ret_t1)}</span>
                  <span className="ret-chip">T+5 {pct(item.ret_t5)}</span>
                  {onFindSimilar && (
                    <button
                      className="find-similar-btn"
                      onClick={(e) => { e.stopPropagation(); onFindSimilar(item.news_id); }}
                    >
                      寻找相似
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
