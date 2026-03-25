import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import StockSelector from './components/StockSelector';
import CandlestickChart from './components/CandlestickChart';
import NewsPanel from './components/NewsPanel';
import NewsCategoryPanel from './components/NewsCategoryPanel';
import RangeAnalysisPanel from './components/RangeAnalysisPanel';
import RangeQueryPopup from './components/RangeQueryPopup';
import RangeNewsPanel from './components/RangeNewsPanel';
import SimilarDaysPanel from './components/SimilarDaysPanel';
import SimilarNewsPanel from './components/SimilarNewsPanel';
import PredictionPanel from './components/PredictionPanel';
import './App.css';

interface RangeSelection {
  startDate: string;
  endDate: string;
  priceChange?: number;
  popupX?: number;
  popupY?: number;
}

interface ArticleSelection {
  newsId: string;
  date: string;
}

interface TickerRow {
  symbol: string;
  last_ohlc_fetch?: string | null;
}

interface PipelineTask {
  task_id: string;
  task_type: string;
  status: string;
  message: string | null;
  error_text: string | null;
}

interface PipelineStatusResponse {
  last_news_fetch?: string | null;
  ohlc_count?: number;
  pending_alignment?: number;
  pending_layer1?: number;
  deepseek_enabled?: boolean;
  task_tracking_enabled?: boolean;
  latest_task?: PipelineTask | null;
}

function App() {
  const [activeTickers, setActiveTickers] = useState<string[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState('');
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [hoveredOhlc, setHoveredOhlc] = useState<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    change: number;
  } | null>(null);
  const [selectedRange, setSelectedRange] = useState<RangeSelection | null>(null);
  const [rangeQuestion, setRangeQuestion] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSimilarNewsId, setSelectedSimilarNewsId] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<ArticleSelection | null>(null);

  // Locked article state (click-to-lock)
  const [lockedArticle, setLockedArticle] = useState<ArticleSelection | null>(null);

  // News category filter
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeCategoryIds, setActiveCategoryIds] = useState<string[]>([]);
  const [activeCategoryColor, setActiveCategoryColor] = useState<string | null>(null);

  // Chart area ref for popup positioning
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const [chartRect, setChartRect] = useState<DOMRect | undefined>(undefined);
  const selectedSymbolRef = useRef('');
  const selectionRequestRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const clearPoll = useCallback((intervalId?: ReturnType<typeof setInterval> | null) => {
    const target = intervalId ?? pollRef.current;
    if (target) {
      clearInterval(target);
    }
    if (!intervalId || pollRef.current === intervalId) {
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    selectedSymbolRef.current = selectedSymbol;
  }, [selectedSymbol]);

  // Update chartRect when range is selected (for popup positioning)
  useEffect(() => {
    if (selectedRange && chartAreaRef.current) {
      setChartRect(chartAreaRef.current.getBoundingClientRect());
    }
  }, [selectedRange]);

  const handleHover = useCallback(
    (date: string | null, ohlc?: { date: string; open: number; high: number; low: number; close: number; change: number }) => {
      // Don't update hovered date when locked
      if (!lockedArticle) {
        setHoveredDate(date);
      }
      setHoveredOhlc(ohlc || null);
    },
    [lockedArticle]
  );

  const handleRangeSelect = useCallback((range: RangeSelection | null) => {
    setSelectedRange(range);
    setRangeQuestion(null);
    if (range) {
      setSelectedDay(null);
      setSelectedSimilarNewsId(null);
      setSelectedArticle(null);
      setLockedArticle(null);
    }
  }, []);

  const handleArticleSelect = useCallback((article: ArticleSelection | null) => {
    if (article === null) {
      // Unlock
      setLockedArticle(null);
      setSelectedArticle(null);
      return;
    }
    // Toggle: click same dot → unlock, different dot → lock new
    setLockedArticle((prev) => {
      if (prev && prev.newsId === article.newsId) {
        // Unlock
        setSelectedArticle(null);
        return null;
      }
      // Lock new
      setSelectedArticle(article);
      setSelectedRange(null);
      setRangeQuestion(null);
      setSelectedDay(null);
      setSelectedSimilarNewsId(null);
      setHoveredDate(article.date);
      return article;
    });
  }, []);

  const handleDayClick = useCallback((date: string) => {
    setSelectedDay(date);
    setSelectedRange(null);
    setRangeQuestion(null);
    setSelectedSimilarNewsId(null);
    setSelectedArticle(null);
    setLockedArticle(null);
  }, []);

  const handleRangeAsk = useCallback((question: string) => {
    setRangeQuestion(question);
  }, []);

  const handleFindSimilarNews = useCallback((newsId: string) => {
    setSelectedSimilarNewsId(newsId);
    setSelectedRange(null);
    setRangeQuestion(null);
    setSelectedDay(null);
  }, []);

  const handleCategoryChange = useCallback((category: string | null, articleIds: string[], color?: string) => {
    setActiveCategory(category);
    setActiveCategoryIds(articleIds);
    setActiveCategoryColor(color ?? null);
  }, []);

  // Refresh key: incrementing this triggers child components to re-fetch data
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    return () => {
      selectionRequestRef.current += 1;
      clearPoll();
    };
  }, [clearPoll]);

  const handleSelectSymbol = useCallback((symbol: string) => {
    if (symbol === selectedSymbolRef.current) {
      return;
    }

    const requestId = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestId;
    selectedSymbolRef.current = symbol;
    setSelectedSymbol(symbol);
    setHoveredDate(null);
    setHoveredOhlc(null);
    setSelectedRange(null);
    setRangeQuestion(null);
    setSelectedDay(null);
    setSelectedSimilarNewsId(null);
    setSelectedArticle(null);
    setLockedArticle(null);
    setActiveCategory(null);
    setActiveCategoryIds([]);
    setActiveCategoryColor(null);
    setPipelineError(null);

    // Clear any existing poll
    clearPoll();

    // Trigger background news fetch whenever a stock is selected
    axios.post('/api/pipeline/fetch', { symbol }).then((res) => {
      if (selectionRequestRef.current !== requestId || selectedSymbolRef.current !== symbol) {
        return;
      }

      const fetchStatus = res.data?.status as string | undefined;
      const fetchEnd = typeof res.data?.end === 'string' ? String(res.data.end).slice(0, 10) : null;
      const fetchTaskId = typeof res.data?.task_id === 'string' ? res.data.task_id : null;

      if (fetchStatus === 'up_to_date') {
        setPipelineError(null);
        setRefreshKey((k) => k + 1);
        return;
      }

      // Poll pipeline status (every 3s, max 120s) until fetch + Layer1 are done.
      let attempts = 0;
      let ohlcReady = false;
      const intervalId = setInterval(() => {
        if (selectionRequestRef.current !== requestId || selectedSymbolRef.current !== symbol) {
          clearPoll(intervalId);
          return;
        }

        attempts++;
        if (attempts > 40) {
          clearPoll(intervalId);
          setRefreshKey((k) => k + 1);
          return;
        }

        axios.get<PipelineStatusResponse>(`/api/pipeline/status/${symbol}`).then((r) => {
          if (selectionRequestRef.current !== requestId || selectedSymbolRef.current !== symbol) {
            clearPoll(intervalId);
            return;
          }

          const status = r.data || {};
          const latestTask = status.latest_task;
          const ohlcCount = Number(status.ohlc_count ?? 0);
          const pendingAlignment = Number(status.pending_alignment ?? 0);
          const pendingLayer1 = Number(status.pending_layer1 ?? 0);
          const deepseekEnabled = Boolean(status.deepseek_enabled);
          const lastNewsFetch = typeof status.last_news_fetch === 'string'
            ? String(status.last_news_fetch).slice(0, 10)
            : null;
          const taskTrackingEnabled = Boolean(status.task_tracking_enabled);

          if (!ohlcReady && ohlcCount > 0) {
            ohlcReady = true;
            setRefreshKey((k) => k + 1);
          }

          if (taskTrackingEnabled && fetchTaskId && latestTask && latestTask.task_id === fetchTaskId) {
            if (latestTask.status === 'failed') {
              setPipelineError(latestTask.error_text || latestTask.message || '数据同步失败');
              clearPoll(intervalId);
              return;
            }
            if (latestTask.status === 'success' || latestTask.status === 'partial_success') {
              setPipelineError(null);
              setRefreshKey((k) => k + 1);
              clearPoll(intervalId);
              return;
            }
          }

          const fetchDone = !fetchEnd || (lastNewsFetch !== null && lastNewsFetch >= fetchEnd);
          const alignedDone = pendingAlignment === 0;
          const layer1Done = !deepseekEnabled || pendingLayer1 === 0;

          if (fetchDone && alignedDone && layer1Done) {
            setPipelineError(null);
            setRefreshKey((k) => k + 1);
            clearPoll(intervalId);
          }
        }).catch(() => {});
      }, 3000);
      pollRef.current = intervalId;
    }).catch(() => {
      setPipelineError('触发数据同步失败');
    });
  }, [clearPoll]);

  useEffect(() => {
    let cancelled = false;
    axios
      .get<TickerRow[]>('/api/stocks')
      .then((res) => {
        if (cancelled) return;
        const tickers = res.data
          .filter((t) => t.last_ohlc_fetch)
          .map((t) => t.symbol);
        setActiveTickers(tickers);
        if (tickers.length > 0 && !selectedSymbolRef.current) {
          handleSelectSymbol(tickers[0]);
        }
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [handleSelectSymbol]);

  function handleAddTicker(symbol: string) {
    if (!activeTickers.includes(symbol)) {
      setActiveTickers((prev) => [...prev, symbol]);
    }
  }

  // Effective date for NewsPanel: locked takes priority
  const effectiveDate = lockedArticle?.date ?? hoveredDate;
  const isLocked = lockedArticle !== null;

  // Right panel priority: rangeQuestion > rangeNews > similarNews > selectedDay > default NewsPanel
  function renderRightPanel() {
    if (selectedRange && rangeQuestion) {
      return (
        <RangeAnalysisPanel
          symbol={selectedSymbol}
          startDate={selectedRange.startDate}
          endDate={selectedRange.endDate}
          question={rangeQuestion}
          onClear={() => {
            setSelectedRange(null);
            setRangeQuestion(null);
          }}
        />
      );
    }
    if (selectedRange && !rangeQuestion) {
      return (
        <RangeNewsPanel
          symbol={selectedSymbol}
          startDate={selectedRange.startDate}
          endDate={selectedRange.endDate}
          priceChange={selectedRange.priceChange}
          onClose={() => setSelectedRange(null)}
          onAskAI={handleRangeAsk}
        />
      );
    }
    if (selectedSimilarNewsId) {
      return (
        <SimilarNewsPanel
          newsId={selectedSimilarNewsId}
          symbol={selectedSymbol}
          onClose={() => setSelectedSimilarNewsId(null)}
        />
      );
    }
    if (selectedDay) {
      return (
        <SimilarDaysPanel
          symbol={selectedSymbol}
          date={selectedDay}
          onClose={() => setSelectedDay(null)}
        />
      );
    }
    return (
      <>
        <NewsPanel
          symbol={selectedSymbol}
          refreshKey={refreshKey}
          hoveredDate={effectiveDate}
          onFindSimilar={handleFindSimilarNews}
          highlightedNewsId={selectedArticle?.newsId || null}
          isLocked={isLocked}
          onUnlock={() => {
            setLockedArticle(null);
            setSelectedArticle(null);
          }}
          highlightedCategoryIds={activeCategory !== null ? activeCategoryIds : undefined}
          categoryFilterActive={activeCategory !== null}
        />
      </>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <h1>PokieTicker</h1>
        </div>
        <StockSelector
          activeTickers={activeTickers}
          selectedSymbol={selectedSymbol}
          onSelect={handleSelectSymbol}
          onAdd={handleAddTicker}
        />
        {selectedRange ? (
          <div className="header-ohlc">
            <span className="ohlc-date">{selectedRange.startDate} ~ {selectedRange.endDate}</span>
            <span className="range-badge">已选择区间</span>
          </div>
        ) : hoveredOhlc ? (
          <div className="header-ohlc">
            <span className="ohlc-date">{hoveredOhlc.date}</span>
            <span className="ohlc-label">O</span>
            <span className="ohlc-val">¥{hoveredOhlc.open.toFixed(2)}</span>
            <span className="ohlc-label">H</span>
            <span className="ohlc-val">¥{hoveredOhlc.high.toFixed(2)}</span>
            <span className="ohlc-label">L</span>
            <span className="ohlc-val">¥{hoveredOhlc.low.toFixed(2)}</span>
            <span className="ohlc-label">C</span>
            <span className="ohlc-val">¥{hoveredOhlc.close.toFixed(2)}</span>
            <span className={`ohlc-change ${hoveredOhlc.change >= 0 ? 'up' : 'down'}`}>
              {hoveredOhlc.change >= 0 ? '+' : ''}
              {hoveredOhlc.change.toFixed(2)}%
            </span>
          </div>
        ) : null}
        <div className="header-right">
          <a href="https://mitrui.com" target="_blank" rel="noopener noreferrer" className="header-link">
            mitrui.com
          </a>
          <a href="https://github.com/owengetinfo-design/PokieTicker" target="_blank" rel="noopener noreferrer" className="header-link header-github">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
            <span className="github-text">源码</span>
          </a>
        </div>
      </header>

      <main className="app-main">
        {pipelineError && (
          <div
            style={{
              gridColumn: '1 / -1',
              margin: '0 0 12px',
              padding: '10px 14px',
              border: '1px solid rgba(239, 83, 80, 0.4)',
              borderRadius: 10,
              background: 'rgba(239, 83, 80, 0.08)',
              color: '#ff8a80',
              fontSize: 14,
            }}
          >
            后台同步失败：{pipelineError}
          </div>
        )}
        <div className="chart-area" ref={chartAreaRef}>
          {selectedSymbol ? (
            <>
              <CandlestickChart
                symbol={selectedSymbol}
                refreshKey={refreshKey}
                lockedNewsId={lockedArticle?.newsId ?? null}
                highlightedArticleIds={activeCategory !== null ? activeCategoryIds : null}
                highlightColor={activeCategoryColor}
                onHover={handleHover}
                onRangeSelect={handleRangeSelect}
                onArticleSelect={handleArticleSelect}
                onDayClick={handleDayClick}
              />
              {selectedRange && !rangeQuestion && (
                <RangeQueryPopup
                  range={selectedRange}
                  chartRect={chartRect}
                  onAsk={handleRangeAsk}
                  onClose={() => setSelectedRange(null)}
                />
              )}
            </>
          ) : (
            <div className="chart-placeholder">请选择一只股票查看图表</div>
          )}
        </div>
        {selectedSymbol && (
          <div className="prediction-area">
            <PredictionPanel symbol={selectedSymbol} refreshKey={refreshKey} />
          </div>
        )}
        <div className="news-area">
          {selectedSymbol && (
            <NewsCategoryPanel
              symbol={selectedSymbol}
              refreshKey={refreshKey}
              activeCategory={activeCategory}
              onCategoryChange={handleCategoryChange}
            />
          )}
          {renderRightPanel()}
        </div>
      </main>
    </div>
  );
}

export default App;
