import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

interface Ticker {
  symbol: string;
  name: string;
  sector?: string;
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
  const searchRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setShowPanel(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
                <strong>{t.symbol}</strong> <span>{t.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}