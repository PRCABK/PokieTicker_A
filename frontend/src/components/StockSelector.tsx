import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

interface Ticker {
  symbol: string;
  name: string;
  sector?: string;
  alias_hits?: string | null;
}

interface AliasRow {
  symbol?: string;
  alias: string;
  alias_type?: string | null;
}

interface KeywordSnapshotResponse {
  symbol: string;
  name?: string;
  sector?: string;
  builtin_keywords: string[];
  aliases: AliasRow[];
  keywords: string[];
}

interface Props {
  activeTickers: string[];
  selectedSymbol: string;
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
}

const GROUPS: Record<string, string[]> = {
  '热门A股': ['600895.SH', '600519.SH', '000858.SZ', '601318.SH', '000001.SZ', '300750.SZ', '002594.SZ'],
  '金融': ['000001.SZ', '600036.SH', '601398.SH', '601166.SH', '600030.SH', '601318.SH'],
  '消费': ['600519.SH', '000858.SZ', '000568.SZ', '603288.SH', '600887.SH', '000333.SZ'],
  '科技': ['002415.SZ', '000063.SZ', '600745.SH', '603019.SH', '688981.SH', '688111.SH'],
  '新能源': ['300750.SZ', '002594.SZ', '601012.SH', '600438.SH', '002460.SZ'],
  '医药': ['600276.SH', '000661.SZ', '300760.SZ', '603259.SH'],
  '其他': [],
};

export default function StockSelector({ activeTickers, selectedSymbol, onSelect, onAdd }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Ticker[]>([]);
  const [showSearch, setShowSearch] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showAliasPanel, setShowAliasPanel] = useState(false);
  const [aliasRows, setAliasRows] = useState<AliasRow[]>([]);
  const [keywordSnapshot, setKeywordSnapshot] = useState<KeywordSnapshotResponse | null>(null);
  const [aliasInput, setAliasInput] = useState('');
  const [aliasTypeInput, setAliasTypeInput] = useState('');
  const [aliasLoading, setAliasLoading] = useState(false);
  const [aliasError, setAliasError] = useState('');
  const [aliasNotice, setAliasNotice] = useState('');
  const searchRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const aliasRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
      if (aliasRef.current && !aliasRef.current.contains(e.target as Node)) {
        setShowAliasPanel(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  async function loadAliasSnapshot(symbol: string) {
    setAliasLoading(true);
    setAliasError('');
    setAliasNotice('');
    try {
      const res = await axios.get<KeywordSnapshotResponse>(`/api/stocks/${symbol}/keywords`);
      setKeywordSnapshot(res.data);
      setAliasRows(res.data.aliases || []);
    } catch {
      setKeywordSnapshot(null);
      setAliasRows([]);
      setAliasError('实体词典加载失败');
    } finally {
      setAliasLoading(false);
    }
  }

  useEffect(() => {
    if (showAliasPanel && selectedSymbol) {
      void loadAliasSnapshot(selectedSymbol);
      return;
    }
    setKeywordSnapshot(null);
    setAliasRows([]);
    setAliasError('');
    setAliasNotice('');
  }, [selectedSymbol, showAliasPanel]);

  function handleSearch(q: string) {
    setQuery(q);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 1) {
      setResults([]);
      setShowSearch(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`/api/stocks/search?q=${encodeURIComponent(q)}`);
        setResults(res.data);
        setShowSearch(true);
      } catch {
        setResults([]);
      }
    }, 300);
  }

  function handlePick(ticker: Ticker) {
    setQuery('');
    setShowSearch(false);
    setShowPanel(false);
    if (!activeTickers.includes(ticker.symbol)) {
      onAdd(ticker.symbol);
    }
    onSelect(ticker.symbol);
  }

  function handleSelectTicker(sym: string) {
    setShowPanel(false);
    onSelect(sym);
  }

  async function handleSaveAlias() {
    const alias = aliasInput.trim();
    if (!selectedSymbol || !alias) return;
    setAliasLoading(true);
    setAliasError('');
    setAliasNotice('');
    try {
      await axios.post(`/api/stocks/${selectedSymbol}/aliases`, {
        alias,
        alias_type: aliasTypeInput.trim() || null,
      });
      setAliasInput('');
      setAliasTypeInput('');
      await loadAliasSnapshot(selectedSymbol);
      setAliasNotice('已保存，Layer1 关键词已刷新。');
    } catch {
      setAliasError('保存别名失败');
      setAliasLoading(false);
    }
  }

  async function handleDeleteAlias(alias: string) {
    if (!selectedSymbol) return;
    setAliasLoading(true);
    setAliasError('');
    setAliasNotice('');
    try {
      await axios.delete(`/api/stocks/${selectedSymbol}/aliases`, { params: { alias } });
      await loadAliasSnapshot(selectedSymbol);
      setAliasNotice('已删除，Layer1 关键词已刷新。');
    } catch {
      setAliasError('删除别名失败');
      setAliasLoading(false);
    }
  }

  const activeSet = new Set(activeTickers);
  const renderedGroups = Object.entries(GROUPS)
    .map(([label, symbols]) => ({
      label,
      symbols: symbols.filter((s) => activeSet.has(s)),
    }))
    .filter((g) => g.symbols.length > 0);

  const assigned = new Set(renderedGroups.flatMap((g) => g.symbols));
  const ungrouped = activeTickers.filter((s) => !assigned.has(s)).sort();
  if (ungrouped.length > 0) {
    const otherGroup = renderedGroups.find((g) => g.label === '其他');
    if (otherGroup) {
      otherGroup.symbols.push(...ungrouped);
    } else {
      renderedGroups.push({ label: '其他', symbols: ungrouped });
    }
  }

  return (
    <div className="stock-selector">
      <div className="ticker-dropdown-wrapper" ref={panelRef}>
        <button
          className="ticker-current"
          onClick={() => setShowPanel((v) => !v)}
        >
          <span className="ticker-current-symbol">{selectedSymbol || '---'}</span>
          <span className={`ticker-arrow ${showPanel ? 'open' : ''}`}>&#9662;</span>
        </button>

        {showPanel && (
          <div className="ticker-panel">
            {renderedGroups.map((group) => (
              <div className="ticker-panel-group" key={group.label}>
                <div className="ticker-panel-group-label">{group.label}</div>
                <div className="ticker-panel-group-items">
                  {group.symbols.map((sym) => (
                    <button
                      key={sym}
                      className={`ticker-panel-item ${sym === selectedSymbol ? 'active' : ''}`}
                      onClick={() => handleSelectTicker(sym)}
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ticker-alias-wrapper" ref={aliasRef}>
        <button
          className={`ticker-alias-btn ${showAliasPanel ? 'active' : ''}`}
          disabled={!selectedSymbol}
          onClick={() => {
            setShowAliasPanel((v) => !v);
          }}
        >
          词典
        </button>

        {showAliasPanel && selectedSymbol && (
          <div className="ticker-alias-panel">
            <div className="ticker-alias-header">
              <span className="ticker-alias-title">{selectedSymbol} 实体词典</span>
              <span className="ticker-alias-count">{aliasRows.length} 条</span>
            </div>

            {(keywordSnapshot?.name || keywordSnapshot?.sector) && (
              <div className="ticker-alias-meta">
                {keywordSnapshot?.name && <span className="ticker-alias-meta-chip">{keywordSnapshot.name}</span>}
                {keywordSnapshot?.sector && <span className="ticker-alias-meta-chip">{keywordSnapshot.sector}</span>}
              </div>
            )}

            <div className="ticker-alias-form">
              <input
                type="text"
                placeholder="新增别名"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
              />
              <input
                type="text"
                placeholder="类型，如简称/产品/子公司"
                value={aliasTypeInput}
                onChange={(e) => setAliasTypeInput(e.target.value)}
              />
              <button
                className="ticker-alias-save"
                disabled={aliasLoading || aliasInput.trim().length === 0}
                onClick={() => { void handleSaveAlias(); }}
              >
                保存
              </button>
            </div>

            {aliasError && <div className="ticker-alias-error">{aliasError}</div>}
            {aliasNotice && <div className="ticker-alias-notice">{aliasNotice}</div>}

            <div className="ticker-alias-list">
              {aliasLoading && aliasRows.length === 0 ? (
                <div className="ticker-alias-empty">加载中...</div>
              ) : aliasRows.length > 0 ? (
                aliasRows.map((row) => (
                  <div key={row.alias} className="ticker-alias-item">
                    <div className="ticker-alias-main">
                      <span className="ticker-alias-name">{row.alias}</span>
                      {row.alias_type && <span className="ticker-alias-type">{row.alias_type}</span>}
                    </div>
                    <button
                      className="ticker-alias-delete"
                      disabled={aliasLoading}
                      onClick={() => { void handleDeleteAlias(row.alias); }}
                    >
                      删除
                    </button>
                  </div>
                ))
              ) : (
                <div className="ticker-alias-empty">当前还没有维护别名。</div>
              )}
            </div>

            <div className="ticker-keyword-section">
              <div className="ticker-keyword-header">
                <span className="ticker-keyword-title">Layer1 关键词预览</span>
                <span className="ticker-keyword-count">{keywordSnapshot?.keywords.length ?? 0} 个</span>
              </div>

              <div className="ticker-keyword-subtitle">内置关键词</div>
              {keywordSnapshot?.builtin_keywords?.length ? (
                <div className="ticker-keyword-tags">
                  {keywordSnapshot.builtin_keywords.map((keyword) => (
                    <span key={`builtin-${keyword}`} className="ticker-keyword-tag builtin">{keyword}</span>
                  ))}
                </div>
              ) : (
                <div className="ticker-alias-empty ticker-keyword-empty">当前没有内置关键词。</div>
              )}

              <div className="ticker-keyword-subtitle">最终合并关键词</div>
              {keywordSnapshot?.keywords?.length ? (
                <div className="ticker-keyword-tags">
                  {keywordSnapshot.keywords.map((keyword) => (
                    <span key={`keyword-${keyword}`} className="ticker-keyword-tag">{keyword}</span>
                  ))}
                </div>
              ) : (
                <div className="ticker-alias-empty ticker-keyword-empty">当前没有可用关键词。</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="search-wrapper" ref={searchRef}>
        <input
          type="text"
          placeholder="搜索股票..."
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => results.length > 0 && setShowSearch(true)}
        />
        {showSearch && results.length > 0 && (
          <ul className="search-dropdown">
            {results.map((t) => (
              <li key={t.symbol} onClick={() => handlePick(t)}>
                <div className="search-item-top">
                  <strong>{t.symbol}</strong> <span>{t.name}</span>
                </div>
                {t.alias_hits && (
                  <div className="search-item-alias">别名命中: {t.alias_hits}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
