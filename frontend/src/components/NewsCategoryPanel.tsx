import { useState, useEffect } from 'react';
import axios from 'axios';

interface CategoryInfo {
  label: string;
  count: number;
  article_ids: string[];
  positive_ids: string[];
  negative_ids: string[];
  neutral_ids: string[];
}

interface CategoriesResponse {
  categories: Record<string, CategoryInfo>;
  total: number;
}

interface Props {
  symbol: string;
  refreshKey?: number;
  activeCategory: string | null;
  onCategoryChange: (category: string | null, articleIds: string[], color?: string) => void;
}

const CATEGORY_META: Record<string, { icon: string; zh: string; color: string }> = {
  policy:       { icon: '🏛️', zh: '政策影响',       color: '#f59e0b' },
  earnings:     { icon: '💰', zh: '财报业绩',            color: '#10b981' },
  order_contract: { icon: '📦', zh: '订单合同', color: '#2563eb' },
  product_tech: { icon: '🚀', zh: '产品技术',      color: '#8b5cf6' },
  buyback_increase: { icon: '🛡️', zh: '回购增持', color: '#14b8a6' },
  reduction_unlock: { icon: '📤', zh: '减持解禁', color: '#ef4444' },
  mna_restructuring: { icon: '🔀', zh: '并购重组', color: '#7c3aed' },
  litigation_penalty: { icon: '⚖️', zh: '诉讼处罚', color: '#dc2626' },
  management:   { icon: '👤', zh: '管理层变动',   color: '#06b6d4' },
  other:        { icon: '📌', zh: '其他事件', color: '#64748b' },
};

type SentimentFilter = 'all' | 'positive' | 'negative';

export default function NewsCategoryPanel({ symbol, refreshKey, activeCategory, onCategoryChange }: Props) {
  const [categories, setCategories] = useState<Record<string, CategoryInfo>>({});
  const [sentimentSelection, setSentimentSelection] = useState<{ category: string | null; filter: SentimentFilter }>({
    category: null,
    filter: 'all',
  });

  useEffect(() => {
    if (!symbol) return;
    axios
      .get<CategoriesResponse>(`/api/news/${symbol}/categories`)
      .then((res) => setCategories(res.data.categories))
      .catch(() => setCategories({}));
  }, [symbol, refreshKey]);

  const keys = Object.keys(categories).filter((k) => categories[k].count > 0);
  if (keys.length === 0) return null;

  const sentimentFilter: SentimentFilter = activeCategory && sentimentSelection.category === activeCategory
    ? sentimentSelection.filter
    : 'all';

  function handleSentimentClick(filter: SentimentFilter) {
    if (!activeCategory) return;
    const cat = categories[activeCategory];
    const meta = CATEGORY_META[activeCategory] || { color: '#667eea' };
    setSentimentSelection({ category: activeCategory, filter });
    let ids: string[];
    let color: string;
    if (filter === 'positive') {
      ids = cat.positive_ids;
      color = '#ff5252';
    } else if (filter === 'negative') {
      ids = cat.negative_ids;
      color = '#00e676';
    } else {
      ids = cat.article_ids;
      color = meta.color;
    }
    onCategoryChange(activeCategory, ids, color);
  }

  const activeCat = activeCategory ? categories[activeCategory] : null;

  return (
    <div className="news-category-wrap">
      <div className="news-category-bar">
        {keys.map((key) => {
          const cat = categories[key];
          const meta = CATEGORY_META[key] || { icon: '📌', zh: key, color: '#667eea' };
          const isActive = activeCategory === key;
          return (
            <button
              key={key}
              className={`category-tag ${isActive ? 'category-tag-active' : ''}`}
              style={{
                '--tag-color': meta.color,
                '--tag-color-bg': `${meta.color}18`,
                '--tag-color-bg-active': `${meta.color}30`,
              } as React.CSSProperties}
              onClick={() => {
                if (isActive) {
                  setSentimentSelection({ category: null, filter: 'all' });
                  onCategoryChange(null, []);
                } else {
                  setSentimentSelection({ category: key, filter: 'all' });
                  onCategoryChange(key, cat.article_ids, meta.color);
                }
              }}
            >
              <span className="category-tag-icon">{meta.icon}</span>
              <div className="category-tag-body">
                <span className="category-tag-label">{meta.zh}</span>
                <span className="category-tag-count">{cat.count} {'篇'}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Sentiment sub-filter row — only shown when a category is active */}
      {activeCat && (
        <div className="sentiment-sub-bar">
          <button
            className={`sentiment-sub-btn ${sentimentFilter === 'all' ? 'sentiment-sub-active' : ''}`}
            onClick={() => handleSentimentClick('all')}
          >
            {'全部'} <span className="sentiment-sub-count">{activeCat.count}</span>
          </button>
          <button
            className={`sentiment-sub-btn sentiment-sub-up ${sentimentFilter === 'positive' ? 'sentiment-sub-active' : ''}`}
            onClick={() => handleSentimentClick('positive')}
          >
            {'▲ 利好'} <span className="sentiment-sub-count">{activeCat.positive_ids.length}</span>
          </button>
          <button
            className={`sentiment-sub-btn sentiment-sub-down ${sentimentFilter === 'negative' ? 'sentiment-sub-active' : ''}`}
            onClick={() => handleSentimentClick('negative')}
          >
            {'▼ 利空'} <span className="sentiment-sub-count">{activeCat.negative_ids.length}</span>
          </button>
        </div>
      )}
    </div>
  );
}
