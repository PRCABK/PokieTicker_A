import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import axios from 'axios';

interface Driver {
  name: string;
  value: number;
  importance: number;
  z_score: number;
  contribution: number;
}

interface DriverEvidence extends Driver {
  horizons: string[];
}

interface HorizonPrediction {
  direction: 'up' | 'down';
  confidence: number;
  model_type?: string;
  target_definition?: string;
  benchmark_symbol?: string | null;
  train_stratification?: StratifiedSummary;
  test_stratification?: StratifiedSummary;
  test_stratified_metrics?: StratifiedMetrics;
  top_drivers: Driver[];
  model_accuracy: number | null;
  baseline_accuracy: number | null;
}

interface Stratification {
  board: string;
  cap: string;
  liquidity: string;
}

interface StratifiedBucketSummary {
  count: number;
  ratio: number;
  accuracy?: number;
  baseline?: number;
  actual_up_ratio?: number;
  predicted_up_ratio?: number;
}

type StratifiedSummary = Record<string, Record<string, StratifiedBucketSummary>>;
type StratifiedMetrics = Record<string, Record<string, StratifiedBucketSummary>>;

interface SimilarPeriod {
  period_start: string;
  period_end: string;
  similarity: number;
  avg_sentiment: number;
  n_articles: number;
  ret_after_5d: number | null;
  ret_after_10d: number | null;
}

interface Headline {
  date: string;
  title: string;
  sentiment: string;
  summary: string;
  session_bucket?: string;
  label_anchor?: string;
  event_type?: string;
  event_types?: string[];
}

interface ImpactArticle {
  news_id: string;
  date: string;
  title: string;
  sentiment: string;
  relevance: string | null;
  session_bucket?: string;
  label_anchor?: string;
  event_type?: string;
  event_types?: string[];
  key_discussion: string;
  ret_t0: number | null;
  ret_t1: number | null;
}

interface NewsSummary {
  total: number;
  analyzed?: number;
  relevant_analyzed?: number;
  analysis_scope?: 'relevant' | 'all';
  pending?: number;
  positive: number;
  negative: number;
  neutral: number;
  sentiment_ratio: number;
  top_headlines: Headline[];
  top_impact: ImpactArticle[];
}

interface SimilarStats {
  count: number;
  up_ratio_5d: number;
  up_ratio_10d: number;
  avg_ret_5d: number | null;
  avg_ret_10d: number | null;
}

interface DeepAnalysis {
  news_id: string;
  discussion: string;
  growth_reasons: string;
  decrease_reasons: string;
}

interface Forecast {
  symbol: string;
  window_days: number;
  forecast_date: string;
  news_summary: NewsSummary;
  prediction: Record<string, HorizonPrediction>;
  current_stratification?: Stratification;
  similar_periods: SimilarPeriod[];
  similar_stats: SimilarStats;
  conclusion: string;
  no_model?: boolean;
}

interface BacktestSummaryBlock {
  trades: number;
  win_rate?: number | null;
  avg_return_pct?: number | null;
  total_return_pct?: number | null;
  skipped_trades?: number;
  blocked_limit_up_entries?: number;
  blocked_low_liquidity_entries?: number;
  blocked_halt_resume_entries?: number;
  deferred_limit_down_exits?: number;
  unresolved_limit_down_exits?: number;
  unresolved_halt_overlap_trades?: number;
}

interface TradeStratifiedBucketSummary {
  count: number;
  ratio: number;
  tradable_trades: number;
  skipped_trades: number;
  tradable_ratio?: number;
  skipped_ratio?: number;
  avg_theoretical_return_pct?: number | null;
  avg_tradable_return_pct?: number | null;
  tradable_win_rate?: number | null;
  total_tradable_return_pct?: number | null;
  skipped_reason_counts?: Record<string, number>;
}

type TradeStratification = Record<string, Record<string, TradeStratifiedBucketSummary>>;

interface BacktestResult {
  symbol: string;
  horizon: string;
  overall_accuracy: number;
  overall_baseline: number;
  overall_precision?: number;
  overall_recall?: number;
  overall_f1?: number;
  theoretical_long_only?: BacktestSummaryBlock;
  tradable_long_only?: BacktestSummaryBlock;
  prediction_stratification?: StratifiedMetrics;
  trade_stratification?: TradeStratification;
}

interface Props {
  symbol: string;
  refreshKey?: number;
}

interface PipelineTask {
  task_id: string;
  status: string;
  message: string | null;
  error_text: string | null;
}

interface PipelineStatusResponse {
  latest_task?: PipelineTask | null;
}

type EventBearingItem = {
  event_type?: string;
  event_types?: string[];
};

const EN_STOPWORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further',
  'then', 'once', 'and', 'but', 'or', 'nor', 'not', 'so', 'yet',
  'both', 'either', 'neither', 'each', 'every', 'all', 'any',
  'few', 'more', 'most', 'other', 'some', 'such', 'no', 'only',
  'own', 'same', 'than', 'too', 'very', 'just', 'because', 'about',
  'up', 'its', 'it', 'this', 'that', 'these', 'those', 'he', 'she',
  'they', 'them', 'their', 'what', 'which', 'who', 'whom', 'how',
  'new', 'says', 'said', 'also', 'like', 'now', 'one', 'two',
  'get', 'got', 'make', 'go', 'going', 'set', 'see', 'big', 'still',
]);

const ZH_STOPWORDS = new Set([
  '公司', '股份', '集团', '公告', '发布', '关于', '今日', '昨日', '消息',
  '记者', '获悉', '表示', '相关', '事项', '披露', '进展', '情况', '计划',
  '预计', '实现', '完成', '继续', '推动', '召开', '公布', '新增', '持续',
]);

const SESSION_BUCKET_LABELS: Record<string, string> = {
  pre_market: '盘前',
  intraday_morning: '上午盘中',
  midday_break: '午休',
  intraday_afternoon: '下午盘中',
  post_market: '收盘后',
  non_trading: '非交易日',
};

const LABEL_ANCHOR_LABELS: Record<string, string> = {
  same_day_open: '当日开盘',
  afternoon_open: '午后开盘',
  same_day_close: '当日收盘',
  next_open: '次日开盘',
};

const HORIZON_LABELS: Record<string, string> = {
  t1: 'T+1',
  t3: 'T+3',
  t5: 'T+5',
};

const SENTIMENT_DRIVER_NAMES = new Set([
  'n_articles', 'n_relevant', 'n_positive', 'n_negative', 'n_neutral',
  'sentiment_score', 'relevance_ratio', 'positive_ratio', 'negative_ratio',
  'has_news', 'sentiment_score_3d', 'sentiment_score_5d', 'sentiment_score_10d',
  'positive_ratio_3d', 'positive_ratio_5d', 'positive_ratio_10d',
  'negative_ratio_3d', 'negative_ratio_5d', 'negative_ratio_10d',
  'news_count_3d', 'news_count_5d', 'news_count_10d', 'sentiment_momentum_3d',
]);

const MARKET_DRIVER_PREFIXES = ['mkt_', 'industry_', 'benchmark_', 'excess_strength_'];

const TECHNICAL_DRIVER_NAMES = new Set([
  'ret_1d', 'ret_3d', 'ret_5d', 'ret_10d', 'volatility_5d', 'volatility_10d',
  'volume_ratio_5d', 'amount_ratio_5d', 'amount_percentile_20d',
  'turnover_rate_5d', 'turnover_rate_change', 'circ_mv_log', 'total_mv_log',
  'cap_bucket_id', 'calendar_gap_days', 'resumed_after_halt', 'recent_halt_resume_5d',
  'board_bucket_id', 'is_st', 'price_limit_ratio', 'is_limit_up', 'is_limit_down',
  'limit_up_count_3d', 'limit_up_count_5d', 'limit_up_count_10d',
  'limit_down_count_3d', 'limit_down_count_5d', 'limit_down_count_10d',
  'gap', 'ma5_vs_ma20', 'rsi_14', 'day_of_week',
]);

const DRIVER_LABELS: Record<string, string> = {
  n_articles: '新闻数量',
  n_relevant: '相关新闻数',
  n_positive: '利好新闻数',
  n_negative: '利空新闻数',
  n_neutral: '中性新闻数',
  sentiment_score: '情绪得分',
  relevance_ratio: '相关度占比',
  positive_ratio: '利好占比',
  negative_ratio: '利空占比',
  has_news: '是否有新闻',
  sentiment_score_3d: '3日情绪均值',
  sentiment_score_5d: '5日情绪均值',
  sentiment_score_10d: '10日情绪均值',
  positive_ratio_3d: '3日利好占比',
  positive_ratio_5d: '5日利好占比',
  positive_ratio_10d: '10日利好占比',
  negative_ratio_3d: '3日利空占比',
  negative_ratio_5d: '5日利空占比',
  negative_ratio_10d: '10日利空占比',
  news_count_3d: '3日新闻总数',
  news_count_5d: '5日新闻总数',
  news_count_10d: '10日新闻总数',
  sentiment_momentum_3d: '情绪动量(3日)',
  ret_1d: '1日收益率',
  ret_3d: '3日收益率',
  ret_5d: '5日收益率',
  ret_10d: '10日收益率',
  benchmark_ret_1d: '基准1日收益率',
  benchmark_ret_3d: '基准3日收益率',
  benchmark_ret_5d: '基准5日收益率',
  benchmark_ret_10d: '基准10日收益率',
  benchmark_volatility_5d: '基准5日波动率',
  benchmark_volatility_10d: '基准10日波动率',
  excess_strength_5d: '相对强弱(5日)',
  excess_strength_10d: '相对强弱(10日)',
  volatility_5d: '5日波动率',
  volatility_10d: '10日波动率',
  volume_ratio_5d: '5日量比',
  amount_ratio_5d: '5日成交额比',
  amount_percentile_20d: '20日成交额分位',
  turnover_rate_5d: '5日换手率均值',
  turnover_rate_change: '换手率偏离',
  circ_mv_log: '流通市值',
  total_mv_log: '总市值',
  cap_bucket_id: '市值分桶',
  calendar_gap_days: '交易间隔天数',
  resumed_after_halt: '复牌标记',
  recent_halt_resume_5d: '近期复牌标记',
  board_bucket_id: '板块分桶',
  is_st: 'ST标记',
  price_limit_ratio: '涨跌停阈值',
  is_limit_up: '前一日涨停',
  is_limit_down: '前一日跌停',
  limit_up_count_3d: '3日涨停次数',
  limit_up_count_5d: '5日涨停次数',
  limit_up_count_10d: '10日涨停次数',
  limit_down_count_3d: '3日跌停次数',
  limit_down_count_5d: '5日跌停次数',
  limit_down_count_10d: '10日跌停次数',
  mkt_articles: '市场新闻数',
  mkt_positive: '市场利好新闻数',
  mkt_negative: '市场利空新闻数',
  mkt_tickers_active: '市场活跃个股数',
  mkt_sentiment: '市场情绪',
  mkt_positive_ratio: '市场利好占比',
  mkt_sentiment_3d: '市场3日情绪',
  mkt_sentiment_5d: '市场5日情绪',
  mkt_momentum: '市场情绪动量',
  industry_articles: '行业新闻数',
  industry_positive: '行业利好新闻数',
  industry_negative: '行业利空新闻数',
  industry_tickers_active: '行业活跃个股数',
  industry_sentiment: '行业情绪',
  industry_positive_ratio: '行业利好占比',
  industry_sentiment_3d: '行业3日情绪',
  industry_sentiment_5d: '行业5日情绪',
  industry_momentum: '行业情绪动量',
  gap: '跳空幅度',
  ma5_vs_ma20: '5日均线偏离20日',
  rsi_14: 'RSI(14)',
  day_of_week: '星期效应',
};

const PERCENT_FEATURES = new Set<string>([
  'relevance_ratio', 'positive_ratio', 'negative_ratio',
  'positive_ratio_3d', 'positive_ratio_5d', 'positive_ratio_10d',
  'negative_ratio_3d', 'negative_ratio_5d', 'negative_ratio_10d',
  'ret_1d', 'ret_3d', 'ret_5d', 'ret_10d',
  'benchmark_ret_1d', 'benchmark_ret_3d', 'benchmark_ret_5d', 'benchmark_ret_10d',
  'benchmark_volatility_5d', 'benchmark_volatility_10d',
  'excess_strength_5d', 'excess_strength_10d',
  'volatility_5d', 'volatility_10d', 'gap', 'ma5_vs_ma20', 'amount_percentile_20d',
  'calendar_gap_days', 'mkt_sentiment', 'mkt_positive_ratio', 'mkt_sentiment_3d',
  'mkt_sentiment_5d', 'mkt_momentum', 'industry_sentiment', 'industry_positive_ratio',
  'industry_sentiment_3d', 'industry_sentiment_5d', 'industry_momentum',
]);

const INTEGER_FEATURES = new Set<string>([
  'n_articles', 'n_relevant', 'n_positive', 'n_negative', 'n_neutral',
  'news_count_3d', 'news_count_5d', 'news_count_10d',
  'mkt_articles', 'mkt_positive', 'mkt_negative', 'mkt_tickers_active',
  'industry_articles', 'industry_positive', 'industry_negative', 'industry_tickers_active',
  'limit_up_count_3d', 'limit_up_count_5d', 'limit_up_count_10d',
  'limit_down_count_3d', 'limit_down_count_5d', 'limit_down_count_10d',
]);

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

const BOARD_STRATA_LABELS: Record<string, string> = {
  main_board: '主板',
  chinext: '创业板',
  star_market: '科创板',
  beijing: '北交所',
  unknown: '未知板块',
};

const CAP_STRATA_LABELS: Record<string, string> = {
  small_cap: '小盘',
  mid_cap: '中盘',
  large_cap: '大盘',
  unknown: '未知市值',
};

const LIQUIDITY_STRATA_LABELS: Record<string, string> = {
  illiquid: '低流动性',
  mid_liquidity: '中等流动性',
  high_liquidity: '高流动性',
  unknown: '未知流动性',
};

const STRATA_BUCKET_ORDER: Record<keyof Stratification, string[]> = {
  board: ['main_board', 'chinext', 'star_market', 'beijing', 'unknown'],
  cap: ['small_cap', 'mid_cap', 'large_cap', 'unknown'],
  liquidity: ['illiquid', 'mid_liquidity', 'high_liquidity', 'unknown'],
};

const SKIP_REASON_LABELS: Record<string, string> = {
  limit_up_entry: '涨停追不进',
  low_liquidity: '流动性不足',
  halt_resume_entry: '复牌首日回避',
  halt_overlap: '持仓期停复牌干扰',
  limit_down_exit_unresolved: '跌停卖不出',
};

function normalizeChineseKeyword(token: string): string | null {
  const normalized = token
    .trim()
    .replace(/(股份有限公司|股份|公司|集团)$/u, '')
    .replace(/^[关于对与和及将再拟受获被向从]/u, '');
  if (normalized.length < 2 || normalized.length > 8) return null;
  if (ZH_STOPWORDS.has(normalized)) return null;
  return normalized;
}

function extractKeywords(headlines: Headline[]): string[] {
  const freq = new Map<string, number>();

  for (const headline of headlines) {
    const seen = new Set<string>();
    const title = headline.title || '';

    const englishWords = title.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
    for (const word of englishWords) {
      if (EN_STOPWORDS.has(word) || seen.has(word)) continue;
      seen.add(word);
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    const chineseWords = title.match(/[\u4e00-\u9fff]{2,12}/gu) ?? [];
    for (const raw of chineseWords) {
      const word = normalizeChineseKeyword(raw);
      if (!word || seen.has(word)) continue;
      seen.add(word);
      freq.set(word, (freq.get(word) || 0) + 1);
    }

    const eventTypes = headline.event_types?.length
      ? headline.event_types
      : headline.event_type
        ? [headline.event_type]
        : [];
    for (const eventType of eventTypes) {
      const label = EVENT_TYPE_LABELS[eventType] ?? eventType;
      if (seen.has(label)) continue;
      seen.add(label);
      freq.set(label, (freq.get(label) || 0) + 1);
    }
  }

  return Array.from(freq.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([word]) => word);
}

function renderStyledText(text: string): ReactNode[] {
  const pattern = /(\[[^\]]+\])|(\b(?:bullish|leaning bullish|bearish|leaning bearish|positive|negative)\b)|(看多|偏多|利好|看空|偏空|利空|中性|观望)|([+-]?\d+(?:\.\d+)?%)/gi;

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const [full, model, englishWord, zhWord, pct] = match;

    if (model) {
      parts.push(<span key={key++} className="fc-text-model">{full}</span>);
    } else if (englishWord) {
      const lowerWord = englishWord.toLowerCase();
      const isBull = lowerWord.includes('bullish') || lowerWord === 'positive';
      parts.push(<span key={key++} className={isBull ? 'fc-text-bull' : 'fc-text-bear'}>{full}</span>);
    } else if (zhWord) {
      const isBull = zhWord === '看多' || zhWord === '偏多' || zhWord === '利好';
      const isBear = zhWord === '看空' || zhWord === '偏空' || zhWord === '利空';
      const className = isBull ? 'fc-text-bull' : isBear ? 'fc-text-bear' : '';
      parts.push(className ? <span key={key++} className={className}>{full}</span> : full);
    } else if (pct) {
      const isNeg = pct.startsWith('-');
      parts.push(<span key={key++} className={isNeg ? 'fc-text-pct-down' : 'fc-text-pct-up'}>{full}</span>);
    } else {
      parts.push(full);
    }

    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function splitConclusionToBullets(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])\s*/))
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

function formatDriverName(name: string): string {
  return DRIVER_LABELS[name] ?? name;
}

function formatDriverValue(name: string, value: number): string {
  if (name === 'has_news') return value >= 0.5 ? '有' : '无';
  if (name === 'is_st') return value >= 0.5 ? '是' : '否';
  if (name === 'is_limit_up') return value >= 0.5 ? '是' : '否';
  if (name === 'is_limit_down') return value >= 0.5 ? '是' : '否';
  if (name === 'resumed_after_halt') return value >= 0.5 ? '是' : '否';
  if (name === 'recent_halt_resume_5d') return value >= 0.5 ? '是' : '否';
  if (name === 'day_of_week') {
    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const idx = Math.max(0, Math.min(6, Math.round(value)));
    return days[idx];
  }
  if (name === 'board_bucket_id') {
    const boards = ['主板', '创业板', '科创板', '北交所'];
    const idx = Math.max(0, Math.min(boards.length - 1, Math.round(value)));
    return boards[idx];
  }
  if (name === 'cap_bucket_id') {
    const buckets = ['小盘', '中盘', '大盘'];
    const idx = Math.max(0, Math.min(buckets.length - 1, Math.round(value)));
    return buckets[idx];
  }
  if (name === 'rsi_14') return value.toFixed(1);
  if (INTEGER_FEATURES.has(name)) return `${Math.round(value)}`;
  if (PERCENT_FEATURES.has(name)) return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
  return value.toFixed(3);
}

function formatEventType(eventType?: string): string {
  if (!eventType) return '其他';
  return EVENT_TYPE_LABELS[eventType] ?? eventType;
}

function formatSessionBucket(bucket?: string): string {
  if (!bucket) return '未知时段';
  return SESSION_BUCKET_LABELS[bucket] ?? bucket;
}

function formatLabelAnchor(anchor?: string): string {
  if (!anchor) return '未知锚点';
  return LABEL_ANCHOR_LABELS[anchor] ?? anchor;
}

function formatSentiment(sentiment?: string): string {
  if (sentiment === 'positive') return '利好';
  if (sentiment === 'negative') return '利空';
  if (sentiment === 'neutral') return '中性';
  return '未知';
}

function formatStratificationBucket(dimension: keyof Stratification, bucket?: string): string {
  if (!bucket) return '未知';
  if (dimension === 'board') return BOARD_STRATA_LABELS[bucket] ?? bucket;
  if (dimension === 'cap') return CAP_STRATA_LABELS[bucket] ?? bucket;
  return LIQUIDITY_STRATA_LABELS[bucket] ?? bucket;
}

function formatAccuracy(value?: number): string {
  if (value == null) return '-';
  return `${(value * 100).toFixed(0)}%`;
}

function formatPercentValue(value?: number | null, digits = 1): string {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

function getStratifiedMetric(
  metrics: StratifiedMetrics | undefined,
  dimension: keyof Stratification,
  bucket?: string,
): StratifiedBucketSummary | null {
  if (!metrics || !bucket) return null;
  return metrics[dimension]?.[bucket] ?? null;
}

function getTradeStratifiedMetric(
  metrics: TradeStratification | undefined,
  dimension: keyof Stratification,
  bucket?: string,
): TradeStratifiedBucketSummary | null {
  if (!metrics || !bucket) return null;
  return metrics[dimension]?.[bucket] ?? null;
}

function getTradeBuckets(
  metrics: TradeStratification | undefined,
  dimension: keyof Stratification,
): Array<{ bucket: string; metric: TradeStratifiedBucketSummary }> {
  const entries = Object.entries(metrics?.[dimension] ?? {}) as Array<[string, TradeStratifiedBucketSummary]>;
  const orderedBuckets = STRATA_BUCKET_ORDER[dimension];
  return entries.sort(([bucketA], [bucketB]) => {
    const idxA = orderedBuckets.indexOf(bucketA);
    const idxB = orderedBuckets.indexOf(bucketB);
    const safeA = idxA === -1 ? orderedBuckets.length : idxA;
    const safeB = idxB === -1 ? orderedBuckets.length : idxB;
    return safeA - safeB || bucketA.localeCompare(bucketB);
  }).map(([bucket, metric]) => ({ bucket, metric }));
}

function formatSkipReason(reason: string): string {
  return SKIP_REASON_LABELS[reason] ?? reason;
}

function getSkipSummary(block?: BacktestSummaryBlock): Array<{ label: string; count: number; tone: 'warn' | 'danger' | 'info' }> {
  if (!block) return [];
  const items = [
    { label: formatSkipReason('limit_up_entry'), count: block.blocked_limit_up_entries ?? 0, tone: 'warn' as const },
    { label: formatSkipReason('low_liquidity'), count: block.blocked_low_liquidity_entries ?? 0, tone: 'danger' as const },
    { label: formatSkipReason('halt_resume_entry'), count: block.blocked_halt_resume_entries ?? 0, tone: 'warn' as const },
    { label: formatSkipReason('limit_down_exit_unresolved'), count: block.unresolved_limit_down_exits ?? 0, tone: 'danger' as const },
    { label: formatSkipReason('halt_overlap'), count: block.unresolved_halt_overlap_trades ?? 0, tone: 'info' as const },
  ];
  if ((block.deferred_limit_down_exits ?? 0) > 0) {
    items.push({ label: '跌停后延迟卖出', count: block.deferred_limit_down_exits ?? 0, tone: 'info' });
  }
  return items.filter((item) => item.count > 0);
}

function getBucketTone(dimension: keyof Stratification, bucket: string, metric: TradeStratifiedBucketSummary): string {
  if (dimension !== 'liquidity') return '';
  if ((metric.avg_tradable_return_pct ?? 0) > 0.5) return 'up';
  if ((metric.avg_tradable_return_pct ?? 0) < -0.5) return 'down';
  if (bucket === 'illiquid') return 'warn';
  return '';
}

function describePrediction(pred: HorizonPrediction): { label: string; benchmark?: string | null } {
  if (pred.target_definition === 'excess_return_vs_benchmark' && pred.benchmark_symbol) {
    return {
      label: pred.direction === 'up' ? '相对基准偏强' : '相对基准偏弱',
      benchmark: pred.benchmark_symbol,
    };
  }
  return {
    label: pred.direction === 'up' ? '看涨' : '看跌',
    benchmark: pred.benchmark_symbol ?? null,
  };
}

function getSentimentTone(ratio: number): string {
  if (ratio >= 0.2) return '明显偏多';
  if (ratio >= 0.05) return '偏多';
  if (ratio <= -0.2) return '明显偏空';
  if (ratio <= -0.05) return '偏空';
  return '中性';
}

function classifyDriver(name: string): 'sentiment' | 'market' | 'technical' | 'other' {
  if (SENTIMENT_DRIVER_NAMES.has(name)) return 'sentiment';
  if (MARKET_DRIVER_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'market';
  if (TECHNICAL_DRIVER_NAMES.has(name)) return 'technical';
  return 'other';
}

function aggregateDrivers(prediction: Record<string, HorizonPrediction>): DriverEvidence[] {
  const merged = new Map<string, DriverEvidence>();
  const orderedHorizons = ['t3', 't1', 't5'];

  for (const horizon of orderedHorizons) {
    const pred = prediction[horizon];
    if (!pred) continue;
    for (const driver of pred.top_drivers) {
      const horizonLabel = HORIZON_LABELS[horizon] ?? horizon;
      const existing = merged.get(driver.name);
      if (!existing) {
        merged.set(driver.name, { ...driver, horizons: [horizonLabel] });
        continue;
      }
      if (!existing.horizons.includes(horizonLabel)) {
        existing.horizons.push(horizonLabel);
      }
      if (driver.contribution > existing.contribution) {
        merged.set(driver.name, { ...driver, horizons: existing.horizons });
      }
    }
  }

  return Array.from(merged.values()).sort((a, b) => b.contribution - a.contribution);
}

function summarizeEventTypes(items: EventBearingItem[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const rawTypes = item.event_types?.length ? item.event_types : item.event_type ? [item.event_type] : [];
    const uniqueLabels = new Set(rawTypes.map((eventType) => formatEventType(eventType)));
    for (const label of uniqueLabels) {
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label, count]) => ({ label, count }));
}

function summarizeTiming(headlines: Headline[]): Array<{ label: string; count: number }> {
  const counts = new Map<string, number>();
  for (const headline of headlines) {
    const label = formatSessionBucket(headline.session_bucket);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label, count]) => ({ label, count }));
}

export default function PredictionPanel({ symbol, refreshKey }: Props) {
  const [forecast7, setForecast7] = useState<Forecast | null>(null);
  const [forecast30, setForecast30] = useState<Forecast | null>(null);
  const [backtestT1, setBacktestT1] = useState<BacktestResult | null>(null);
  const [backtestT5, setBacktestT5] = useState<BacktestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(true);
  const [training, setTraining] = useState(false);
  const [deepLoading, setDeepLoading] = useState<string | null>(null);
  const [deepResults, setDeepResults] = useState<Record<string, DeepAnalysis>>({});

  const fetchForecast = useCallback(async (window: number): Promise<Forecast | null> => {
    try {
      const res = await axios.get(`/api/predict/${symbol}/forecast?window=${window}`);
      return res.data as Forecast;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  }, [symbol]);

  const loadForecasts = useCallback(async () => {
    const [f7, f30] = await Promise.all([fetchForecast(7), fetchForecast(30)]);
    setForecast7(f7);
    setForecast30(f30);
    return { f7, f30 };
  }, [fetchForecast]);

  const fetchBacktest = useCallback(async (horizon: 't1' | 't5'): Promise<BacktestResult | null> => {
    try {
      const res = await axios.get(`/api/predict/${symbol}/backtest?horizon=${horizon}`);
      return res.data as BacktestResult;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  }, [symbol]);

  const loadBacktests = useCallback(async () => {
    const [bt1, bt5] = await Promise.all([fetchBacktest('t1'), fetchBacktest('t5')]);
    setBacktestT1(bt1);
    setBacktestT5(bt5);
    return { bt1, bt5 };
  }, [fetchBacktest]);

  const loadPanelData = useCallback(async () => {
    const [{ f7, f30 }, { bt1, bt5 }] = await Promise.all([loadForecasts(), loadBacktests()]);
    return { f7, f30, bt1, bt5 };
  }, [loadForecasts, loadBacktests]);

  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    setError('');
    loadPanelData()
      .then(({ f7, f30 }) => {
        if (!f7 && !f30) setError('NO_MODEL');
      })
      .catch(() => {
        setForecast7(null);
        setForecast30(null);
        setBacktestT1(null);
        setBacktestT5(null);
        setError('预测请求失败');
      })
      .finally(() => setLoading(false));
  }, [symbol, refreshKey, loadPanelData]);

  const keywords = useMemo(() => {
    const currentForecast = forecast7 || forecast30;
    if (!currentForecast) return [];
    return extractKeywords(currentForecast.news_summary.top_headlines);
  }, [forecast7, forecast30]);

  const primaryForecast = forecast7 || forecast30;
  const primary = primaryForecast
    ? (primaryForecast.prediction.t3 || primaryForecast.prediction.t1 || primaryForecast.prediction.t5)
    : null;
  const primaryInfo = primary ? describePrediction(primary) : null;
  const isUp = primary?.direction === 'up';
  const newsSummary = primaryForecast?.news_summary;

  const hasNoModel =
    (forecast7?.no_model && forecast30?.no_model)
    || (forecast7?.no_model && !forecast30)
    || (!forecast7 && forecast30?.no_model);

  function handleTrain() {
    setLoading(true);
    setTraining(true);
    setError('');
    axios.post('/api/pipeline/train', { symbol })
      .then((res) => {
        const taskId = typeof res.data?.task_id === 'string' ? res.data.task_id : null;
        const trackingEnabled = Boolean(res.data?.task_tracking_enabled) && taskId !== null;

        if (!trackingEnabled) {
          let attempts = 0;
          const maxAttempts = 30;
          const poll = () => {
            attempts++;
            Promise.all([loadForecasts(), loadBacktests()]).then(([{ f7, f30 }]) => {
              const stillNoModel =
                (f7?.no_model && f30?.no_model)
                || (f7?.no_model && !f30)
                || (!f7 && f30?.no_model)
                || (!f7 && !f30);
              if (!stillNoModel) {
                setLoading(false);
                setTraining(false);
              } else if (attempts < maxAttempts) {
                setTimeout(poll, 5000);
              } else {
                setError('训练超时，数据可能仍在抓取中，请稍后刷新');
                setLoading(false);
                setTraining(false);
              }
            }).catch(() => {
              setError('预测请求失败');
              setLoading(false);
              setTraining(false);
            });
          };
          setTimeout(poll, 5000);
          return;
        }

        let attempts = 0;
        const maxAttempts = 36;
        const poll = async () => {
          attempts++;
          try {
            const statusRes = await axios.get<PipelineStatusResponse>(`/api/pipeline/status/${symbol}`);
            const latestTask = statusRes.data.latest_task;

            if (latestTask && latestTask.task_id === taskId) {
              if (latestTask.status === 'failed') {
                setError(latestTask.error_text || latestTask.message || '训练失败');
                setLoading(false);
                setTraining(false);
                return;
              }

              if (latestTask.status === 'success' || latestTask.status === 'partial_success') {
                const { f7, f30 } = await loadPanelData();
                if (!f7 && !f30) {
                  setError(latestTask.message || '训练完成，但暂无可用模型');
                } else {
                  setError('');
                }
                setLoading(false);
                setTraining(false);
                return;
              }
            }

            if (attempts < maxAttempts) {
              setTimeout(poll, 5000);
            } else {
              setError('训练超时，状态未知，请稍后刷新');
              setLoading(false);
              setTraining(false);
            }
          } catch {
            setError('训练状态查询失败');
            setLoading(false);
            setTraining(false);
          }
        };
        setTimeout(poll, 5000);
      })
      .catch(() => {
        setError('训练请求失败');
        setLoading(false);
        setTraining(false);
      });
  }

  if (loading) {
    return (
      <div className="pred-panel">
        <div className="pred-header" onClick={() => setExpanded(!expanded)}>
          <span className="pred-title">AI 研判</span>
          <span className="pred-loading-dot" />
          <span className="pred-loading-text">{training ? '正在抓取数据并训练模型，请稍候...' : '正在生成证据面板...'}</span>
        </div>
      </div>
    );
  }

  if (error || (!forecast7 && !forecast30)) {
    return (
      <div className="pred-panel">
        <div className="pred-header">
          <span className="pred-title">AI 研判</span>
          <span className="pred-no-model">
            {error === 'NO_MODEL' ? '该股票暂无预测模型' : error || '暂无数据'}
          </span>
          {(error === 'NO_MODEL' || error.includes('暂无可用模型')) && (
            <button className="pred-train-btn" disabled={loading} onClick={handleTrain}>
              训练模型
            </button>
          )}
        </div>
      </div>
    );
  }

  const currentStratification = primaryForecast?.current_stratification;

  return (
    <div className={`pred-panel ${expanded ? 'pred-expanded' : ''}`}>
      <div className="pred-header" onClick={() => setExpanded(!expanded)}>
        <span className="pred-title">AI 研判</span>
        {primary && primaryInfo && (
          <>
            <div className={`pred-arrow ${isUp ? 'up' : 'down'}`}>{isUp ? '\u2191' : '\u2193'}</div>
            <span className={`pred-dir ${isUp ? 'up' : 'down'}`}>
              {primaryInfo.benchmark ? (isUp ? '偏强' : '偏弱') : primaryInfo.label}
            </span>
            <div className="pred-conf-bar">
              <div
                className={`pred-conf-fill ${isUp ? 'up' : 'down'}`}
                style={{ width: `${primary.confidence * 100}%` }}
              />
              <span className="pred-conf-label">{(primary.confidence * 100).toFixed(0)}%</span>
            </div>
          </>
        )}
        {!primary && hasNoModel && (
          <>
            <span className="pred-no-model">暂无预测模型</span>
            <button className="pred-train-btn" onClick={(e) => { e.stopPropagation(); handleTrain(); }}>
              训练模型
            </button>
          </>
        )}
        {newsSummary && (
          <span className="pred-news-badge">
            共 {newsSummary.total} 篇新闻 · 利好 {newsSummary.positive} / 利空 {newsSummary.negative}
            {(newsSummary.pending ?? 0) > 0 ? ` · 待分析 ${newsSummary.pending}` : ''}
          </span>
        )}
        <span className="pred-expand-icon">{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>

      {expanded && (
        <div className="pred-details">
          {keywords.length > 0 && (
            <div className="fc-keywords-section">
              <div className="fc-section-title">核心话题</div>
              <div className="fc-keywords">
                {keywords.map((keyword) => (
                  <span key={keyword} className="fc-keyword-pill">{keyword}</span>
                ))}
              </div>
            </div>
          )}

          {(backtestT1 || backtestT5) && (
            <BacktestEvidenceSection
              backtests={[
                ...(backtestT1 ? [{ label: 'T+1', result: backtestT1 }] : []),
                ...(backtestT5 ? [{ label: 'T+5', result: backtestT5 }] : []),
              ]}
              currentStratification={currentStratification}
            />
          )}

          {forecast7 && (
            <ForecastSection
              label="7天窗口"
              forecast={forecast7}
              symbol={symbol}
              deepLoading={deepLoading}
              deepResults={deepResults}
              setDeepLoading={setDeepLoading}
              setDeepResults={setDeepResults}
            />
          )}

          {forecast30 && (
            <ForecastSection
              label="30天窗口"
              forecast={forecast30}
              symbol={symbol}
              deepLoading={deepLoading}
              deepResults={deepResults}
              setDeepLoading={setDeepLoading}
              setDeepResults={setDeepResults}
            />
          )}
        </div>
      )}
    </div>
  );
}

function BacktestEvidenceSection({
  backtests,
  currentStratification,
}: {
  backtests: Array<{ label: string; result: BacktestResult }>;
  currentStratification?: Stratification;
}) {
  return (
    <EvidenceSection title="回测约束面" note="同时看理论命中和可交易结果，避免只看方向准确率。">
      <>
        {backtests.map(({ label, result }) => (
          <BacktestCard
            key={label}
            label={label}
            result={result}
            currentStratification={currentStratification}
          />
        ))}
      </>
    </EvidenceSection>
  );
}

function BacktestCard({
  label,
  result,
  currentStratification,
}: {
  label: string;
  result: BacktestResult;
  currentStratification?: Stratification;
}) {
  const boardPredMetric = getStratifiedMetric(result.prediction_stratification, 'board', currentStratification?.board);
  const capPredMetric = getStratifiedMetric(result.prediction_stratification, 'cap', currentStratification?.cap);
  const liquidityPredMetric = getStratifiedMetric(result.prediction_stratification, 'liquidity', currentStratification?.liquidity);
  const boardTradeMetric = getTradeStratifiedMetric(result.trade_stratification, 'board', currentStratification?.board);
  const capTradeMetric = getTradeStratifiedMetric(result.trade_stratification, 'cap', currentStratification?.cap);
  const liquidityTradeMetric = getTradeStratifiedMetric(result.trade_stratification, 'liquidity', currentStratification?.liquidity);
  const skipSummary = getSkipSummary(result.tradable_long_only);
  const hasTradeBuckets = ['board', 'cap', 'liquidity'].some(
    (dimension) => getTradeBuckets(result.trade_stratification, dimension as keyof Stratification).length > 0,
  );

  return (
    <div className="fc-evidence-card fc-backtest-card">
      <div className="fc-section-caption">{label} 回测</div>
      <div className="fc-mini-metrics fc-mini-metrics-compact">
        <div className="fc-mini-metric fc-mini-metric-dense">
          <span className="fc-mini-label">方向准确率</span>
          <span className="fc-mini-value">{formatAccuracy(result.overall_accuracy)}</span>
          <span className="fc-mini-subvalue">基线 {formatAccuracy(result.overall_baseline)}</span>
        </div>
        <div className="fc-mini-metric fc-mini-metric-dense">
          <span className="fc-mini-label">理论收益</span>
          <span className="fc-mini-value">{formatPercentValue(result.theoretical_long_only?.total_return_pct, 1)}</span>
          <span className="fc-mini-subvalue">
            交易 {result.theoretical_long_only?.trades ?? 0} / 均值 {formatPercentValue(result.theoretical_long_only?.avg_return_pct, 2)}
          </span>
        </div>
        <div className="fc-mini-metric fc-mini-metric-dense">
          <span className="fc-mini-label">可交易收益</span>
          <span className="fc-mini-value">{formatPercentValue(result.tradable_long_only?.total_return_pct, 1)}</span>
          <span className="fc-mini-subvalue">
            可成交 {result.tradable_long_only?.trades ?? 0} / 跳过 {result.tradable_long_only?.skipped_trades ?? 0}
          </span>
        </div>
      </div>

      {skipSummary.length > 0 && (
        <div className="fc-backtest-skip-block">
          <div className="fc-section-caption">回避与成交限制</div>
          <div className="fc-chip-row">
            {skipSummary.map((item) => (
              <span key={item.label} className={`fc-evidence-chip fc-evidence-chip-${item.tone}`}>
                {item.label} {item.count}
              </span>
            ))}
          </div>
        </div>
      )}

      {currentStratification && (
        <div className="fc-backtest-strata">
          <div className="fc-section-caption">当前分层回测表现</div>
          <div className="fc-chip-row">
            <span className="fc-evidence-chip">{formatStratificationBucket('board', currentStratification.board)}</span>
            <span className="fc-evidence-chip">{formatStratificationBucket('cap', currentStratification.cap)}</span>
            <span className="fc-evidence-chip">{formatStratificationBucket('liquidity', currentStratification.liquidity)}</span>
          </div>
          <div className="fc-backtest-strata-grid">
            <BacktestStrataMetric
              title="板块层"
              predMetric={boardPredMetric}
              tradeMetric={boardTradeMetric}
            />
            <BacktestStrataMetric
              title="市值层"
              predMetric={capPredMetric}
              tradeMetric={capTradeMetric}
            />
            <BacktestStrataMetric
              title="流动性层"
              predMetric={liquidityPredMetric}
              tradeMetric={liquidityTradeMetric}
            />
          </div>
        </div>
      )}

      {hasTradeBuckets && (
        <div className="fc-backtest-buckets">
          <div className="fc-section-caption">完整分层可交易差异</div>
          <div className="fc-backtest-bucket-grid">
            <BacktestBucketTable
              title="板块层"
              dimension="board"
              metrics={result.trade_stratification}
            />
            <BacktestBucketTable
              title="市值层"
              dimension="cap"
              metrics={result.trade_stratification}
            />
            <BacktestBucketTable
              title="流动性层"
              dimension="liquidity"
              metrics={result.trade_stratification}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BacktestStrataMetric({
  title,
  predMetric,
  tradeMetric,
}: {
  title: string;
  predMetric: StratifiedBucketSummary | null;
  tradeMetric: TradeStratifiedBucketSummary | null;
}) {
  return (
    <div className="fc-backtest-strata-item">
      <span className="fc-mini-label">{title}</span>
      <span className="fc-mini-subvalue">
        准确率 {formatAccuracy(predMetric?.accuracy)} / 样本 {predMetric?.count ?? 0}
      </span>
      <span className="fc-mini-subvalue">
        可交易 {tradeMetric?.tradable_trades ?? 0} / 跳过 {tradeMetric?.skipped_trades ?? 0}
      </span>
      <span className="fc-mini-subvalue">
        可交易总收益 {formatPercentValue(tradeMetric?.total_tradable_return_pct, 1)}
      </span>
      {!!tradeMetric?.skipped_reason_counts && Object.keys(tradeMetric.skipped_reason_counts).length > 0 && (
        <span className="fc-mini-subvalue">
          主要约束 {Object.entries(tradeMetric.skipped_reason_counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([reason, count]) => `${formatSkipReason(reason)} ${count}`)
            .join(' / ')}
        </span>
      )}
    </div>
  );
}

function BacktestBucketTable({
  title,
  dimension,
  metrics,
}: {
  title: string;
  dimension: keyof Stratification;
  metrics?: TradeStratification;
}) {
  const rows = getTradeBuckets(metrics, dimension);

  return (
    <div className="fc-backtest-bucket-table">
      <div className="fc-backtest-bucket-title">{title}</div>
      {rows.length > 0 ? (
        <div className="fc-backtest-bucket-list">
          {rows.map(({ bucket, metric }) => (
            <div
              key={`${dimension}-${bucket}`}
              className={`fc-backtest-bucket-row ${getBucketTone(dimension, bucket, metric)}`}
            >
              <div className="fc-backtest-bucket-head">
                <span className="fc-backtest-bucket-name">{formatStratificationBucket(dimension, bucket)}</span>
                <span className="fc-backtest-bucket-ratio">样本占比 {(metric.ratio * 100).toFixed(0)}%</span>
              </div>
              <div className="fc-backtest-bucket-metrics">
                <span>可成交 {metric.tradable_trades}/{metric.count}</span>
                <span>跳过 {`${((metric.skipped_ratio ?? 0) * 100).toFixed(0)}%`}</span>
                <span>均值 {formatPercentValue(metric.avg_tradable_return_pct, 2)}</span>
                <span>总收益 {formatPercentValue(metric.total_tradable_return_pct, 1)}</span>
              </div>
              {!!metric.skipped_reason_counts && Object.keys(metric.skipped_reason_counts).length > 0 && (
                <div className="fc-backtest-bucket-skip">
                  {Object.entries(metric.skipped_reason_counts)
                    .sort((a, b) => b[1] - a[1])
                    .map(([reason, count]) => (
                      <span key={`${bucket}-${reason}`} className="fc-backtest-skip-pill">
                        {formatSkipReason(reason)} {count}
                      </span>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="fc-evidence-empty">暂无该维度的可交易分层统计。</div>
      )}
    </div>
  );
}

function ForecastSection({
  label,
  forecast,
  symbol,
  deepLoading,
  deepResults,
  setDeepLoading,
  setDeepResults,
}: {
  label: string;
  forecast: Forecast;
  symbol: string;
  deepLoading: string | null;
  deepResults: Record<string, DeepAnalysis>;
  setDeepLoading: (id: string | null) => void;
  setDeepResults: Dispatch<SetStateAction<Record<string, DeepAnalysis>>>;
}) {
  const t1 = forecast.prediction.t1;
  const t3 = forecast.prediction.t3;
  const t5 = forecast.prediction.t5;
  const primary = t3 || t1 || t5;
  const primaryInfo = primary ? describePrediction(primary) : null;
  const isUp = primary?.direction === 'up';
  const newsSummary = forecast.news_summary;
  const stats = forecast.similar_stats;
  const conclusionBullets = splitConclusionToBullets(forecast.conclusion || '');

  const aggregatedDrivers = aggregateDrivers(forecast.prediction);
  const sentimentDrivers = aggregatedDrivers.filter((driver) => classifyDriver(driver.name) === 'sentiment').slice(0, 4);
  const technicalDrivers = aggregatedDrivers.filter((driver) => classifyDriver(driver.name) === 'technical').slice(0, 5);
  const marketDrivers = aggregatedDrivers.filter((driver) => classifyDriver(driver.name) === 'market').slice(0, 5);
  const currentStratification = forecast.current_stratification;
  const boardMetric = getStratifiedMetric(primary?.test_stratified_metrics, 'board', currentStratification?.board);
  const capMetric = getStratifiedMetric(primary?.test_stratified_metrics, 'cap', currentStratification?.cap);
  const liquidityMetric = getStratifiedMetric(primary?.test_stratified_metrics, 'liquidity', currentStratification?.liquidity);

  const eventSummary = summarizeEventTypes([...newsSummary.top_impact, ...newsSummary.top_headlines]);
  const timingSummary = summarizeTiming(newsSummary.top_headlines);
  const sentimentTone = getSentimentTone(newsSummary.sentiment_ratio);
  const analyzed = newsSummary.analyzed ?? 0;
  const relevantAnalyzed = newsSummary.relevant_analyzed ?? analyzed;

  return (
    <div className="fc-section-block">
      <div className="fc-section-divider">{label}</div>

      {primary && primaryInfo && (
        <div className={`fc-hero ${isUp ? 'fc-hero-up' : 'fc-hero-down'}`}>
          <span className="fc-hero-arrow">{isUp ? '\u2191' : '\u2193'}</span>
          <div className="fc-hero-text">
            <span className="fc-hero-label">{label}核心判断</span>
            <span className="fc-hero-dir">{primaryInfo.label}</span>
            {primaryInfo.benchmark && <span className="fc-hero-sub">对比基准 {primaryInfo.benchmark}</span>}
          </div>
          <span className="fc-hero-conf">{(primary.confidence * 100).toFixed(0)}%</span>
        </div>
      )}

      {!primary && <div className="fc-evidence-note">当前只有新闻侧证据，尚未形成模型预测结果。</div>}

      {conclusionBullets.length > 0 && (
        <div className="fc-analysis">
          <div className="fc-section-title">综合结论</div>
          <ul className="fc-bullet-list">
            {conclusionBullets.map((bullet, index) => (
              <li key={index} className="fc-bullet-item">{renderStyledText(bullet)}</li>
            ))}
          </ul>
        </div>
      )}

      {(t1 || t3 || t5) && (
        <div className="fc-model-section">
          <div className="fc-section-title">模型视角</div>
          <div className="fc-predictions">
            {t1 && <PredictionCard label="T+1" pred={t1} />}
            {t3 && <PredictionCard label="T+3" pred={t3} />}
            {t5 && <PredictionCard label="T+5" pred={t5} />}
          </div>
        </div>
      )}

      <EvidenceSection title="分层视角" note="把当前股票放回 A 股真实分层里看，避免把不同板块和流动性样本混成一个平均结论。">
        {currentStratification ? (
          <>
            <div className="fc-evidence-card">
              <div className="fc-section-caption">当前所处分层</div>
              <div className="fc-chip-row">
                <span className="fc-evidence-chip">{formatStratificationBucket('board', currentStratification.board)}</span>
                <span className="fc-evidence-chip">{formatStratificationBucket('cap', currentStratification.cap)}</span>
                <span className="fc-evidence-chip">{formatStratificationBucket('liquidity', currentStratification.liquidity)}</span>
              </div>
            </div>

            <div className="fc-mini-metrics">
              <StratificationMetricCard
                title="板块层"
                bucketLabel={formatStratificationBucket('board', currentStratification.board)}
                metric={boardMetric}
              />
              <StratificationMetricCard
                title="市值层"
                bucketLabel={formatStratificationBucket('cap', currentStratification.cap)}
                metric={capMetric}
              />
              <StratificationMetricCard
                title="流动性层"
                bucketLabel={formatStratificationBucket('liquidity', currentStratification.liquidity)}
                metric={liquidityMetric}
              />
            </div>

            <div className="fc-evidence-note">
              {primary?.test_stratified_metrics
                ? '下方准确率基于该预测窗口对应模型的历史测试集分层统计。'
                : '当前预测尚未携带分层测试统计，先展示所属分层。'}
            </div>
          </>
        ) : (
          <div className="fc-evidence-empty">当前 forecast 结果里没有可用的分层信息。</div>
        )}
      </EvidenceSection>

      <EvidenceSection title="事件面" note="先看消息是什么，再看它发生在什么时段。">
        <div className="fc-evidence-card">
          <div className="fc-section-caption">事件类型分布</div>
          {eventSummary.length > 0 ? (
            <div className="fc-chip-row">
              {eventSummary.map((item) => (
                <span key={item.label} className="fc-evidence-chip">{item.label} {item.count}</span>
              ))}
            </div>
          ) : (
            <div className="fc-evidence-empty">近期新闻尚未形成稳定的事件类型分布。</div>
          )}
        </div>

        <div className="fc-evidence-card">
          <div className="fc-section-caption">发布时间归因</div>
          {timingSummary.length > 0 ? (
            <div className="fc-chip-row">
              {timingSummary.map((item) => (
                <span key={item.label} className="fc-evidence-chip fc-evidence-chip-subtle">{item.label} {item.count}</span>
              ))}
            </div>
          ) : (
            <div className="fc-evidence-empty">缺少可用的发布时间归因数据。</div>
          )}
        </div>

        {newsSummary.top_impact.length > 0 ? (
          <div className="fc-impact-section">
            {newsSummary.top_impact.map((article) => {
              const retClass = article.ret_t0 == null ? 'neutral' : article.ret_t0 >= 0 ? 'up' : 'down';
              const deep = deepResults[article.news_id];
              const isAnalyzing = deepLoading === article.news_id;

              return (
                <div key={article.news_id} className={`fc-impact-card ${retClass !== 'neutral' ? `fc-impact-${retClass}` : ''}`}>
                  <div className="fc-impact-header">
                    <span className={`fc-impact-ret ${retClass}`}>
                      {article.ret_t0 != null ? `${article.ret_t0 >= 0 ? '+' : ''}${article.ret_t0.toFixed(2)}%` : '-'}
                    </span>
                    <span className={`fc-impact-sentiment ${article.sentiment || 'unknown'}`}>{formatSentiment(article.sentiment)}</span>
                    <span className="fc-impact-date">{article.date}</span>
                  </div>
                  <div className="fc-impact-title">{article.title}</div>
                  <div className="fc-chip-row fc-impact-chip-row">
                    {(article.event_types?.length ? article.event_types : article.event_type ? [article.event_type] : [])
                      .slice(0, 3)
                      .map((eventType) => (
                        <span key={`${article.news_id}-${eventType}`} className="fc-evidence-chip">
                          {formatEventType(eventType)}
                        </span>
                      ))}
                    <span className="fc-evidence-chip fc-evidence-chip-subtle">{formatSessionBucket(article.session_bucket)}</span>
                    <span className="fc-evidence-chip fc-evidence-chip-subtle">锚点 {formatLabelAnchor(article.label_anchor)}</span>
                  </div>
                  {article.key_discussion && <div className="fc-impact-summary">{article.key_discussion}</div>}
                  {deep ? (
                    <div className="fc-deep-result">
                      <div className="fc-deep-discussion">{deep.discussion}</div>
                      {deep.growth_reasons && (
                        <div className="fc-deep-reasons fc-deep-bull">
                          <span className="fc-deep-reasons-label">▲ 利好因素</span>
                          <div className="fc-deep-reasons-text">{deep.growth_reasons}</div>
                        </div>
                      )}
                      {deep.decrease_reasons && (
                        <div className="fc-deep-reasons fc-deep-bear">
                          <span className="fc-deep-reasons-label">▼ 风险因素</span>
                          <div className="fc-deep-reasons-text">{deep.decrease_reasons}</div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <button
                      className="fc-deep-btn"
                      disabled={isAnalyzing}
                      onClick={() => {
                        setDeepLoading(article.news_id);
                        axios
                          .post('/api/analysis/deep', { news_id: article.news_id, symbol })
                          .then((res) => {
                            setDeepResults((prev) => ({ ...prev, [article.news_id]: res.data }));
                          })
                          .catch(() => {})
                          .finally(() => setDeepLoading(null));
                      }}
                    >
                      {isAnalyzing ? '分析中...' : 'AI 深度分析'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="fc-evidence-empty">暂无可展示的关键影响新闻。</div>
        )}
      </EvidenceSection>

      <EvidenceSection title="情绪面" note="这里看近期新闻倾向、分析覆盖率，以及模型是否持续关注新闻变量。">
        <div className="fc-mini-metrics">
          <div className="fc-mini-metric">
            <span className="fc-mini-label">已分析</span>
            <span className="fc-mini-value">{analyzed}/{newsSummary.total}</span>
          </div>
          <div className="fc-mini-metric">
            <span className="fc-mini-label">利好/利空</span>
            <span className="fc-mini-value">{newsSummary.positive}/{newsSummary.negative}</span>
          </div>
          <div className="fc-mini-metric">
            <span className="fc-mini-label">情绪倾向</span>
            <span className={`fc-mini-value ${newsSummary.sentiment_ratio >= 0 ? 'up' : 'down'}`}>{sentimentTone}</span>
          </div>
          <div className="fc-mini-metric">
            <span className="fc-mini-label">待分析</span>
            <span className="fc-mini-value">{newsSummary.pending ?? 0}</span>
          </div>
        </div>

        <div className="fc-evidence-note">
          {newsSummary.analysis_scope === 'relevant'
            ? `情绪统计优先基于 ${relevantAnalyzed} 篇已判定为相关的新闻。`
            : '情绪统计基于全部已分析新闻。'}
          {' '}情绪差值 {newsSummary.sentiment_ratio >= 0 ? '+' : ''}{newsSummary.sentiment_ratio.toFixed(2)}。
        </div>

        {sentimentDrivers.length > 0 ? (
          <DriverEvidenceSection title="模型关注的情绪变量" drivers={sentimentDrivers} />
        ) : (
          <div className="fc-evidence-empty">当前模型返回中没有明显的情绪类主驱动。</div>
        )}

        {newsSummary.top_headlines.length > 0 && (
          <div className="fc-news-section">
            <div className="fc-section-caption">近期重点新闻</div>
            {newsSummary.top_headlines.slice(0, 5).map((headline, index) => (
              <div key={`${headline.date}-${index}`} className="fc-news-item">
                <span className={`fc-news-dot ${headline.sentiment === 'positive' ? 'up' : headline.sentiment === 'negative' ? 'down' : ''}`} />
                <div className="fc-news-content">
                  <div className="fc-news-title">{headline.title}</div>
                  {headline.summary && <div className="fc-news-summary">{headline.summary}</div>}
                </div>
                <div className="fc-news-meta">
                  <span className="fc-news-date">{headline.date}</span>
                  <span className="fc-news-bucket">{formatSessionBucket(headline.session_bucket)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </EvidenceSection>

      <EvidenceSection title="技术面" note="这里汇总量价、涨跌停、换手和停复牌等 A 股交易特征。">
        {technicalDrivers.length > 0 ? (
          <DriverEvidenceSection title="当前显著技术/交易特征" drivers={technicalDrivers} />
        ) : (
          <div className="fc-evidence-empty">当前没有明显进入前列的技术类驱动。</div>
        )}
      </EvidenceSection>

      <EvidenceSection title="市场环境面" note="把市场和行业共振单独拆出来，避免把系统性行情误判成个股独立事件。">
        {primaryInfo?.benchmark && (
          <div className="fc-evidence-note">当前主要目标是相对基准 {primaryInfo.benchmark} 的强弱判断，而不是单纯绝对涨跌。</div>
        )}
        {marketDrivers.length > 0 ? (
          <DriverEvidenceSection title="市场/行业主驱动" drivers={marketDrivers} />
        ) : (
          <div className="fc-evidence-empty">当前模型没有把市场环境变量放到前列。</div>
        )}
      </EvidenceSection>

      <EvidenceSection title="相似历史面" note="用相似阶段的后续表现，校验当前研判是否有历史参照。">
        {stats.count > 0 ? (
          <div className="fc-similar-section">
            <div className="fc-similar-stats">
              <div className="fc-stat">
                <span className="fc-stat-label">5日上涨率</span>
                <span className={`fc-stat-value ${stats.up_ratio_5d > 0.5 ? 'up' : 'down'}`}>
                  {(stats.up_ratio_5d * 100).toFixed(0)}%
                </span>
              </div>
              <div className="fc-stat">
                <span className="fc-stat-label">5日平均收益</span>
                <span className={`fc-stat-value ${stats.avg_ret_5d == null ? 'neutral' : (stats.avg_ret_5d >= 0 ? 'up' : 'down')}`}>
                  {stats.avg_ret_5d != null ? `${stats.avg_ret_5d >= 0 ? '+' : ''}${stats.avg_ret_5d.toFixed(1)}%` : '-'}
                </span>
              </div>
              <div className="fc-stat">
                <span className="fc-stat-label">10日上涨率</span>
                <span className={`fc-stat-value ${stats.up_ratio_10d > 0.5 ? 'up' : 'down'}`}>
                  {(stats.up_ratio_10d * 100).toFixed(0)}%
                </span>
              </div>
              <div className="fc-stat">
                <span className="fc-stat-label">10日平均收益</span>
                <span className={`fc-stat-value ${stats.avg_ret_10d == null ? 'neutral' : (stats.avg_ret_10d >= 0 ? 'up' : 'down')}`}>
                  {stats.avg_ret_10d != null ? `${stats.avg_ret_10d >= 0 ? '+' : ''}${stats.avg_ret_10d.toFixed(1)}%` : '-'}
                </span>
              </div>
            </div>

            <div className="fc-periods-list">
              {forecast.similar_periods.slice(0, 5).map((period, index) => (
                <div key={index} className="fc-period-card">
                  <div className="fc-period-header">
                    <span className="fc-period-dates">{period.period_start} ~ {period.period_end}</span>
                    <span className="fc-period-sim">{(period.similarity * 100).toFixed(0)}% 相似度</span>
                  </div>
                  <div className="fc-period-detail">
                    <span>{period.n_articles} 篇新闻</span>
                    <span>情绪得分 {period.avg_sentiment >= 0 ? '+' : ''}{period.avg_sentiment.toFixed(2)}</span>
                    {period.ret_after_5d != null && (
                      <span className={period.ret_after_5d >= 0 ? 'up' : 'down'}>
                        5日 {period.ret_after_5d >= 0 ? '+' : ''}{period.ret_after_5d.toFixed(1)}%
                      </span>
                    )}
                    {period.ret_after_10d != null && (
                      <span className={period.ret_after_10d >= 0 ? 'up' : 'down'}>
                        10日 {period.ret_after_10d >= 0 ? '+' : ''}{period.ret_after_10d.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="fc-evidence-empty">历史相似样本不足，暂时无法形成可靠参照。</div>
        )}
      </EvidenceSection>
    </div>
  );
}

function EvidenceSection({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className="fc-evidence-section">
      <div className="fc-section-title">{title}</div>
      {note && <div className="fc-section-note">{note}</div>}
      <div className="fc-evidence-grid">{children}</div>
    </div>
  );
}

function DriverEvidenceSection({
  title,
  drivers,
}: {
  title: string;
  drivers: DriverEvidence[];
}) {
  const maxContrib = drivers.length > 0
    ? Math.max(...drivers.map((driver) => driver.contribution), 0.01)
    : 0.01;

  return (
    <div className="fc-evidence-card fc-driver-evidence-card">
      <div className="fc-section-caption">{title}</div>
      <div className="fc-drivers">
        {drivers.map((driver) => (
          <div key={driver.name} className="fc-driver-row">
            <span className="fc-driver-name" title={`${formatDriverName(driver.name)} (${driver.name})`}>
              {formatDriverName(driver.name)}
            </span>
            <div className="fc-driver-bar-track">
              <div
                className={`fc-driver-bar-fill ${driver.z_score > 0 ? 'up' : 'down'}`}
                style={{ width: `${(driver.contribution / maxContrib) * 100}%` }}
              />
            </div>
            <span className="fc-driver-val" title={`${driver.name}=${driver.value.toFixed(6)}, z=${driver.z_score.toFixed(2)}`}>
              {formatDriverValue(driver.name, driver.value)}
            </span>
            <span className="fc-driver-horizons">{driver.horizons.join(' / ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StratificationMetricCard({
  title,
  bucketLabel,
  metric,
}: {
  title: string;
  bucketLabel: string;
  metric: StratifiedBucketSummary | null;
}) {
  return (
    <div className="fc-mini-metric fc-mini-metric-dense">
      <span className="fc-mini-label">{title}</span>
      <span className="fc-mini-value">{bucketLabel}</span>
      <span className="fc-mini-subvalue">
        测试样本 {metric?.count ?? 0} · 占比 {metric ? `${(metric.ratio * 100).toFixed(0)}%` : '-'}
      </span>
      <span className="fc-mini-subvalue">
        准确率 {formatAccuracy(metric?.accuracy)} / 基线 {formatAccuracy(metric?.baseline)}
      </span>
    </div>
  );
}

function PredictionCard({ label, pred }: { label: string; pred: HorizonPrediction }) {
  const isUp = pred.direction === 'up';
  const hasAccuracy = pred.model_accuracy != null && pred.baseline_accuracy != null;
  const lift = hasAccuracy ? (pred.model_accuracy! - pred.baseline_accuracy!) : 0;
  const predictionInfo = describePrediction(pred);

  return (
    <div className={`fc-pred-card ${isUp ? 'up' : 'down'}`}>
      <div className="fc-pred-header">
        <span className="fc-pred-label">{label}</span>
        <span className={`fc-pred-dir ${isUp ? 'up' : 'down'}`}>
          {isUp ? '\u2191' : '\u2193'} {predictionInfo.label}
        </span>
        <span className="fc-pred-conf">{(pred.confidence * 100).toFixed(0)}%</span>
      </div>
      {predictionInfo.benchmark && <div className="fc-pred-submeta">对比基准 {predictionInfo.benchmark}</div>}
      {hasAccuracy && (
        <div className="fc-pred-meta">
          模型 {(pred.model_accuracy! * 100).toFixed(1)}% / 基线 {(pred.baseline_accuracy! * 100).toFixed(1)}% / 提升 {lift >= 0 ? '+' : ''}{(lift * 100).toFixed(1)}pp
        </div>
      )}
    </div>
  );
}
