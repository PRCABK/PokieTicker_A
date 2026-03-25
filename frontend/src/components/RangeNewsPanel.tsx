import { useState, useEffect } from 'react';
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
  chinese_summary: string | null;
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

interface RangeNewsResponse {
  total: number;
  date_range: [string, string];
  articles: NewsItem[];
  top_bullish: NewsItem[];
  top_bearish: NewsItem[];
}

interface Props {
  symbol: string;
  startDate: string;
  endDate: string;
  priceChange?: number;
  onClose: () => void;
  onAskAI: (question: string) => void;
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

export default function RangeNewsPanel({ symbol, startDate, endDate, priceChange, onClose, onAskAI }: Props) {
  const requestKey = `${symbol}|${startDate}|${endDate}`;
  const [result, setResult] = useState<{
    requestKey: string;
    data: RangeNewsResponse | null;
    error: string | null;
  } | null>(null);
  const [showAllState, setShowAllState] = useState<{ requestKey: string; value: boolean }>({
    requestKey,
    value: false,
  });

  useEffect(() => {
    let cancelled = false;
    axios
      .get<RangeNewsResponse>(`/api/news/${symbol}/range?start=${startDate}&end=${endDate}`)
      .then((res) => {
        if (cancelled) return;
        setResult({ requestKey, data: res.data, error: null });
      })
      .catch(() => {
        if (cancelled) return;
        setResult({ requestKey, data: null, error: '加载区间新闻失败' });
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, startDate, endDate, requestKey]);

  const loading = result?.requestKey !== requestKey;
  const data = result?.requestKey === requestKey ? result.data : null;
  const error = result?.requestKey === requestKey ? result.error : null;
  const showAll = showAllState.requestKey === requestKey ? showAllState.value : false;

  const change = priceChange ?? 0;
  const isUp = change >= 0;

  return (
    <div className="news-panel">
      <div className="news-panel-header">
        <h2>区间新闻</h2>
        <span className={`range-news-change ${isUp ? 'up' : 'down'}`}>
          {isUp ? '+' : ''}{change.toFixed(2)}%
        </span>
        <button className="range-clear-btn" onClick={onClose}>关闭</button>
      </div>

      <div className="range-news-dates">
        {startDate} ~ {endDate}
        {data && <span className="news-count" style={{ marginLeft: 8 }}>共 {data.total} 篇</span>}
      </div>

      {loading ? (
        <div className="news-empty">
          <div className="range-loading">
            <div className="range-spinner" />
            <span>正在加载区间新闻...</span>
          </div>
        </div>
      ) : error ? (
        <div className="news-empty">{error}</div>
      ) : !data || data.total === 0 ? (
        <div className="news-empty">该区间内无新闻</div>
      ) : (
        <div className="news-list">
          {/* Bullish section */}
          {data.top_bullish.length > 0 && (
            <div className="range-news-section">
              <div className="range-news-section-title bullish">
                ▲ 利好新闻 ({data.top_bullish.length})
              </div>
              {data.top_bullish.map((item) => (
                <RangeNewsCard key={item.news_id} item={item} />
              ))}
            </div>
          )}

          {/* Bearish section */}
          {data.top_bearish.length > 0 && (
            <div className="range-news-section">
              <div className="range-news-section-title bearish">
                ▼ 利空新闻 ({data.top_bearish.length})
              </div>
              {data.top_bearish.map((item) => (
                <RangeNewsCard key={item.news_id} item={item} />
              ))}
            </div>
          )}

          {/* All news toggle */}
          {data.articles.length > 0 && (
            <div className="range-news-all">
              <button
                className="range-news-all-btn"
                onClick={() => setShowAllState({ requestKey, value: !showAll })}
              >
                {showAll ? '收起' : '展开'} 全部 {data.total} 篇新闻
                <span className="range-news-all-arrow">{showAll ? '▲' : '▼'}</span>
              </button>
              {showAll && data.articles.map((item) => (
                <RangeNewsCard key={item.news_id} item={item} />
              ))}
            </div>
          )}

          {/* Ask AI button */}
          <button
            className="range-news-ai-btn"
            onClick={() => onAskAI("是什么驱动了价格的变动？")}
          >
            问问 PokieTicker
          </button>
        </div>
      )}
    </div>
  );
}

function RangeNewsCard({ item }: { item: NewsItem }) {
  const sentiment = item.sentiment || 'neutral';
  const borderClass = sentiment === 'positive' ? 'card-positive' : sentiment === 'negative' ? 'card-negative' : 'card-neutral';

  return (
    <div className={`news-card ${borderClass}`}>
      <div className="news-card-top">
        <span className={`sentiment-dot ${sentiment}`} />
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
        <span className="news-publisher">{item.trade_date} · {item.publisher}</span>
        <div className="returns-chips">
          <span className="ret-chip">T+0 {pct(item.ret_t0)}</span>
          <span className="ret-chip">T+1 {pct(item.ret_t1)}</span>
        </div>
      </div>
    </div>
  );
}
