'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { Modal } from '@/components/ui/modal';
import { ScoreBar } from '@/components/ui/score-bar';
import { CompositeScoreGauge } from '@/components/ui/composite-score-gauge';
import { LabeledBlock } from '@/components/ui/agent-badge';
import { Button } from '@/components/ui/button';
import { PriceChart } from '@/components/ui/price-chart';
import type { PriceRow } from '@/components/ui/price-chart';
import { TechnicalBreakdown } from '@/components/market/technical-breakdown';
import { FundamentalBreakdown } from '@/components/market/fundamental-breakdown';
import { formatCurrency, formatPct } from '@/lib/formatters';
import {
  getAgentScoresForTicker,
  getTickerFundamentals,
  getTickerNews,
  getTickerQuote,
  getTickerConclusion,
} from '@/lib/queries';
import type { AgentScore } from '@shared/types/scores';
import type { TickerQuote, TickerFundamental, TickerNewsItem, TickerConclusion } from '@/lib/queries';
import { ASSET_TYPE_MAP, getWeightsForTicker } from '@shared/lib/constants';

type AgentWeights = { technical: number; sentiment: number; fundamental: number; regime: number };
type WeightsConfig = { stock: AgentWeights; crypto: AgentWeights; cryptoSentimentMissing: AgentWeights } | null;
import { TrendingUp, TrendingDown, ExternalLink, ShoppingCart, RefreshCw } from 'lucide-react';

export interface TickerDetailModalProps {
  open: boolean;
  onClose: () => void;
  ticker: string | null;
  tickerName?: string | undefined;
  preloadedPrice?: number | undefined;
  onBuy?: ((ticker: string, quantity: number, price: number) => void) | undefined;
  asOfDate?: string | undefined;
}

const ASSET_NAMES: Record<string, string> = {
  AAPL: 'Apple', MSFT: 'Microsoft', NVDA: 'NVIDIA', GOOGL: 'Alphabet',
  AMZN: 'Amazon', META: 'Meta Platforms', TSLA: 'Tesla', 'BRK.B': 'Berkshire Hathaway',
  JPM: 'JPMorgan Chase', V: 'Visa', JNJ: 'Johnson & Johnson', UNH: 'UnitedHealth',
  XOM: 'Exxon Mobil', PG: 'Procter & Gamble', HD: 'Home Depot',
  MA: 'Mastercard', LLY: 'Eli Lilly', ABBV: 'AbbVie', MRK: 'Merck', PEP: 'PepsiCo',
  KO: 'Coca-Cola', AVGO: 'Broadcom', COST: 'Costco', ADBE: 'Adobe',
  CRM: 'Salesforce', NFLX: 'Netflix', AMD: 'AMD', QCOM: 'Qualcomm',
  TXN: 'Texas Instruments', HON: 'Honeywell', BA: 'Boeing', CAT: 'Caterpillar',
  GS: 'Goldman Sachs', MS: 'Morgan Stanley', BAC: 'Bank of America',
  WMT: 'Walmart', TGT: 'Target', DIS: 'Walt Disney', INTC: 'Intel',
  IBM: 'IBM', GE: 'GE Aerospace', F: 'Ford', GM: 'General Motors',
  UBER: 'Uber', LYFT: 'Lyft', SHOP: 'Shopify', SQ: 'Block',
  PYPL: 'PayPal', NOW: 'ServiceNow', SNOW: 'Snowflake', PLTR: 'Palantir',
  COIN: 'Coinbase', RBLX: 'Roblox', HOOD: 'Robinhood', SOFI: 'SoFi',
  RIVN: 'Rivian', LCID: 'Lucid', NIO: 'NIO', BABA: 'Alibaba',
  JD: 'JD.com', PDD: 'PDD Holdings', PINS: 'Pinterest', SNAP: 'Snap',
  SPY: 'S&P 500 ETF', QQQ: 'Nasdaq 100 ETF', IWM: 'Russell 2000 ETF',
  VTI: 'Total Market ETF', VOO: 'Vanguard S&P 500', VEA: 'Int\'l Developed ETF',
  EEM: 'Emerging Markets ETF', GLD: 'Gold ETF', SLV: 'Silver ETF',
  USO: 'Oil ETF', TLT: 'Long-Term Treasury ETF', HYG: 'High Yield Bond ETF',
  LQD: 'Investment Grade Bond ETF', XLK: 'Tech Select ETF', XLF: 'Financial ETF',
  XLE: 'Energy ETF', XLV: 'Healthcare ETF', XLI: 'Industrial ETF',
  ARKK: 'ARK Innovation ETF', SCHD: 'Schwab Dividend ETF',
  BTC: 'Bitcoin', ETH: 'Ethereum', BNB: 'BNB', SOL: 'Solana',
  XRP: 'XRP', ADA: 'Cardano', AVAX: 'Avalanche', DOT: 'Polkadot',
  LINK: 'Chainlink', MATIC: 'Polygon', LTC: 'Litecoin', BCH: 'Bitcoin Cash',
  ATOM: 'Cosmos', UNI: 'Uniswap', AAVE: 'Aave', FIL: 'Filecoin',
  ICP: 'Internet Computer', ALGO: 'Algorand', XLM: 'Stellar', VET: 'VeChain',
};

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return formatCurrency(n);
}

export function TickerDetailModal({
  open,
  onClose,
  ticker,
  tickerName,
  preloadedPrice,
  onBuy,
  asOfDate,
}: TickerDetailModalProps) {
  const { supabase } = useAuth();

  const [scores, setScores] = useState<AgentScore[]>([]);
  const [quote, setQuote] = useState<TickerQuote | null>(null);
  const [fundamentals, setFundamentals] = useState<TickerFundamental | null>(null);
  const [news, setNews] = useState<TickerNewsItem[]>([]);
  const [conclusion, setConclusion] = useState<TickerConclusion | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [priceHistory, setPriceHistory] = useState<PriceRow[]>([]);
  const [priceHistoryRange, setPriceHistoryRange] = useState<{ from: string | null; to: string | null } | null>(null);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);

  // Buy flow
  const [showBuyModal, setShowBuyModal] = useState(false);
  const [buyAmount, setBuyAmount] = useState('');

  // Technical breakdown
  const [showTechBreakdown, setShowTechBreakdown] = useState(false);
  // Fundamental breakdown
  const [showFundBreakdown, setShowFundBreakdown] = useState(false);
  // Sentiment info
  const [showSentimentInfo, setShowSentimentInfo] = useState(false);
  // Regime info
  const [showRegimeInfo, setShowRegimeInfo] = useState(false);

  // Dynamic weights from system_config
  const [weightsConfig, setWeightsConfig] = useState<WeightsConfig>(null);

  // Dev refresh
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (!open || !ticker) {
      setScores([]);
      setQuote(null);
      setFundamentals(null);
      setNews([]);
      setConclusion(null);
      setPriceHistory([]);
      setPriceHistoryRange(null);
      setShowBuyModal(false);
      setBuyAmount('');
      setShowTechBreakdown(false);
      setShowFundBreakdown(false);
      setShowSentimentInfo(false);
      setShowRegimeInfo(false);
      return;
    }
    setLoadingData(true);
    setPriceHistoryLoading(true);

    // Fetch scores/quote/fundamentals/news/conclusion in parallel
    Promise.all([
      getAgentScoresForTicker(supabase, ticker, undefined, asOfDate),
      getTickerQuote(supabase, ticker, asOfDate),
      getTickerFundamentals(supabase, ticker, asOfDate),
      getTickerNews(supabase, ticker, 5, asOfDate),
      getTickerConclusion(supabase, ticker, asOfDate),
    ])
      .then(([s, q, f, n, c]) => {
        setScores(s);
        setQuote(q);
        setFundamentals(f);
        setNews(n);
        setConclusion(c);
      })
      .catch(() => {})
      .finally(() => setLoadingData(false));

    // Fetch dynamic weights (cached, fire-and-forget)
    if (!weightsConfig) {
      fetch('/api/config/weights')
        .then((r) => r.json())
        .then((d: { stock: AgentWeights; crypto: AgentWeights; cryptoSentimentMissing: AgentWeights }) =>
          setWeightsConfig(d),
        )
        .catch(() => {});
    }

    // Fetch price history in parallel
    fetch(`/api/ticker/price-history?ticker=${encodeURIComponent(ticker)}&days=90`)
      .then((res) => res.json())
      .then((data: { rows?: { date: string; close: number }[]; dateRange?: { from: string | null; to: string | null } }) => {
        setPriceHistory((data.rows ?? []).map((r) => ({ date: r.date, close: r.close })));
        setPriceHistoryRange(data.dateRange ?? null);
      })
      .catch(() => {
        setPriceHistory([]);
        setPriceHistoryRange(null);
      })
      .finally(() => setPriceHistoryLoading(false));
  }, [open, ticker, supabase, asOfDate]);

  if (!open || !ticker) return null;

  const name = tickerName || ASSET_NAMES[ticker] || ticker;
  const price = quote?.lastPrice ?? preloadedPrice ?? 0;
  const change = quote?.dailyChange ?? 0;
  const changePct = quote?.pctChange ?? 0;
  const isUp = change >= 0;

  const sentimentScore = scores.find((s) => s.agentType === 'sentiment');
  const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
  const sentimentMissing = isCrypto && (!sentimentScore || sentimentScore.confidence === 0 || sentimentScore.dataFreshness === 'missing');

  const compositeScore = scores.length > 0
    ? (() => {
        let w: AgentWeights;
        if (weightsConfig) {
          if (sentimentMissing) w = weightsConfig.cryptoSentimentMissing;
          else if (isCrypto) w = weightsConfig.crypto;
          else w = weightsConfig.stock;
        } else {
          w = getWeightsForTicker(ticker, sentimentMissing);
        }
        const tech = scores.find((s) => s.agentType === 'technical')?.score ?? 0;
        const sent = sentimentScore?.score ?? 0;
        const fund = scores.find((s) => s.agentType === 'fundamental')?.score ?? 0;
        const regime = scores.find((s) => s.agentType === 'market_regime')?.score ?? 0;
        return tech * w.technical + sent * w.sentiment + fund * w.fundamental + regime * w.regime;
      })()
    : undefined;

  const buyPrice = price;
  const parsedAmount = parseFloat(buyAmount);
  const quantity = buyPrice > 0 && parsedAmount > 0 ? parsedAmount / buyPrice : 0;

  function handleBuy() {
    if (!ticker || quantity <= 0 || buyPrice <= 0) return;
    onBuy?.(ticker, quantity, buyPrice);
    setShowBuyModal(false);
    setBuyAmount('');
    onClose();
  }

  async function handleRefresh() {
    if (!ticker || refreshing) return;
    setRefreshing(true);
    setRefreshStatus('idle');
    try {
      const res = await fetch('/api/ticker/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      const data = await res.json();
      setRefreshStatus(data.status === 'success' || data.status === 'partial' ? 'success' : 'error');
      // Re-fetch all data for this ticker
      const [s, q, f, n, c, ph] = await Promise.all([
        getAgentScoresForTicker(supabase, ticker, undefined, asOfDate),
        getTickerQuote(supabase, ticker, asOfDate),
        getTickerFundamentals(supabase, ticker, asOfDate),
        getTickerNews(supabase, ticker, 5, asOfDate),
        getTickerConclusion(supabase, ticker, asOfDate),
        fetch(`/api/ticker/price-history?ticker=${encodeURIComponent(ticker)}&days=90`).then((r) => r.json()) as Promise<{ rows?: { date: string; close: number }[]; dateRange?: { from: string | null; to: string | null } }>,
      ]);
      setScores(s);
      setQuote(q);
      setFundamentals(f);
      setNews(n);
      setConclusion(c);
      setPriceHistory((ph.rows ?? []).map((r) => ({ date: r.date, close: r.close })));
      setPriceHistoryRange(ph.dateRange ?? null);
    } catch {
      setRefreshStatus('error');
    } finally {
      setRefreshing(false);
      setTimeout(() => setRefreshStatus('idle'), 3000);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" onClick={onClose}>
        <div
          className="bg-navy-800 border border-navy-600 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="sticky top-0 bg-navy-800 border-b border-navy-600 px-6 py-4 z-10">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">{name}</h2>
                <span className="text-sm text-gray-500">{ticker}</span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="flex items-center gap-1 px-2 py-1 rounded border border-gray-700 text-[10px] text-gray-500 hover:text-gray-300 hover:border-gray-500 transition-colors disabled:opacity-50"
                  title="Refresh scores & conclusion (dev tool)"
                >
                  <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                  <span>DEV</span>
                  {refreshStatus === 'success' && <span className="text-emerald-400 ml-0.5">&#10003;</span>}
                  {refreshStatus === 'error' && <span className="text-red-400 ml-0.5">&#10007;</span>}
                </button>
                {onBuy && (
                  <button
                    onClick={() => setShowBuyModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-blue/20 text-accent-blue text-xs font-medium hover:bg-accent-blue/30 transition-colors"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" /> Add to Portfolio
                  </button>
                )}
                <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors text-sm">
                  Close
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* Price + Change */}
            <div className="flex items-baseline gap-4 flex-wrap">
              <span className="text-3xl font-bold text-white">{formatCurrency(price)}</span>
              {(change !== 0 || changePct !== 0) && (
                <span className={`flex items-center gap-1 text-sm font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                  {isUp ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                  {isUp ? '+' : ''}{formatCurrency(change)} ({formatPct(changePct)})
                </span>
              )}
            </div>

            {/* Composite Score + Conclusion — two-column row */}
            {compositeScore !== undefined && (
              <div className="flex gap-3">
                {/* Score tile — squarish */}
                <div className="bg-navy-700/50 rounded-lg p-3 flex flex-col items-center justify-center shrink-0 w-[160px]">
                  <span className="text-xs text-gray-400 mb-1">Composite Score</span>
                  <CompositeScoreGauge score={compositeScore} />
                </div>
                {/* Conclusion tile — fills remaining width */}
                <div className="bg-navy-700/50 rounded-lg px-4 py-3 flex-1 min-w-0">
                  <h3 className="text-sm font-medium text-gray-400 mb-1.5">Conclusion</h3>
                  {conclusion ? (
                    <>
                      <p className="text-sm text-gray-300 leading-relaxed">{conclusion.conclusion}</p>
                      {conclusion.date !== new Date().toISOString().split('T')[0] && (
                        <p className="text-xs text-gray-500 mt-1.5">Last updated {new Date(conclusion.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-gray-500 italic">No analysis available yet.</p>
                  )}
                </div>
              </div>
            )}

            {/* Price Chart */}
            <PriceChart
              data={priceHistory}
              dateRange={priceHistoryRange ?? undefined}
              loading={priceHistoryLoading}
            />

            {/* Agent Scores with Bars */}
            {scores.length > 0 && (() => {
              const scoreOrder = ['technical', 'fundamental', 'sentiment', 'market_regime'];
              const sortedScores = [...scores].sort(
                (a, b) => scoreOrder.indexOf(a.agentType) - scoreOrder.indexOf(b.agentType)
              );
              // Compute news date range for sentiment info
              const newsDateRange = news.length > 0
                ? {
                    count: news.length,
                    from: new Date(Math.min(...news.map((n) => new Date(n.publishedAt).getTime()))),
                    to: new Date(Math.max(...news.map((n) => new Date(n.publishedAt).getTime()))),
                  }
                : null;
              const daySpan = newsDateRange
                ? Math.max(1, Math.round((newsDateRange.to.getTime() - newsDateRange.from.getTime()) / (1000 * 60 * 60 * 24)))
                : 0;
              return (
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-3">Agent Scores</h3>
                <div className="space-y-2">
                  {sortedScores.map((s) => {
                    const label = s.agentType === 'technical' ? 'Technical Score'
                      : s.agentType === 'sentiment' ? 'Sentiment Score'
                      : s.agentType === 'fundamental' ? 'Fundamental Score'
                      : s.agentType === 'market_regime' ? 'Market Regime'
                      : `${s.agentType} Score`;
                    const hasDetailBreakdown =
                      (s.agentType === 'technical') ||
                      (s.agentType === 'fundamental' && !isCrypto);
                    const hasInfoButton = hasDetailBreakdown || s.agentType === 'sentiment' || s.agentType === 'market_regime';
                    const isOpen = s.agentType === 'technical' ? showTechBreakdown
                      : s.agentType === 'fundamental' ? showFundBreakdown
                      : s.agentType === 'sentiment' ? showSentimentInfo
                      : s.agentType === 'market_regime' ? showRegimeInfo
                      : false;
                    const toggle = s.agentType === 'technical' ? setShowTechBreakdown
                      : s.agentType === 'fundamental' ? setShowFundBreakdown
                      : s.agentType === 'sentiment' ? setShowSentimentInfo
                      : s.agentType === 'market_regime' ? setShowRegimeInfo
                      : setShowRegimeInfo;
                    return (
                      <div key={s.agentType}>
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 min-w-0">
                            <ScoreBar
                              score={s.score}
                              label={label}
                              confidence={s.confidence}
                            />
                          </div>
                          {hasInfoButton && (
                            <button
                              onClick={() => toggle((v: boolean) => !v)}
                              className={`shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${isOpen ? 'text-accent-blue bg-accent-blue/15' : 'text-gray-400 hover:text-gray-200 bg-navy-700/50 hover:bg-navy-600/50'}`}
                              title={`${isOpen ? 'Hide' : 'Show'} info`}
                            >
                              <span className="text-[11px]">&#9432;</span>
                              <span className="transition-transform duration-200 text-[8px] inline-block" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}>&#9660;</span>
                            </button>
                          )}
                        </div>
                        {/* Technical Score Breakdown — collapsible */}
                        {s.agentType === 'technical' && (
                          <div
                            className="overflow-hidden transition-all duration-300 ease-in-out"
                            style={{
                              maxHeight: showTechBreakdown ? '800px' : '0px',
                              opacity: showTechBreakdown ? 1 : 0,
                            }}
                          >
                            <div className="mt-2 p-3 rounded-lg bg-navy-600/25 border border-navy-500/30">
                              <TechnicalBreakdown
                                componentScores={s.componentScores}
                                explanation={s.explanation}
                                priceHistory={priceHistory}
                              />
                            </div>
                          </div>
                        )}
                        {/* Fundamental Score Breakdown — collapsible, hidden for crypto */}
                        {s.agentType === 'fundamental' && !isCrypto && (
                          <div
                            className="overflow-hidden transition-all duration-300 ease-in-out"
                            style={{
                              maxHeight: showFundBreakdown ? '900px' : '0px',
                              opacity: showFundBreakdown ? 1 : 0,
                            }}
                          >
                            <div className="mt-2 p-3 rounded-lg bg-navy-600/25 border border-navy-500/30">
                              <FundamentalBreakdown
                                componentScores={s.componentScores}
                                fundamentalData={fundamentals}
                                ticker={ticker}
                              />
                            </div>
                          </div>
                        )}
                        {/* Sentiment Info — collapsible */}
                        {s.agentType === 'sentiment' && (
                          <div
                            className="overflow-hidden transition-all duration-300 ease-in-out"
                            style={{
                              maxHeight: showSentimentInfo ? '200px' : '0px',
                              opacity: showSentimentInfo ? 1 : 0,
                            }}
                          >
                            <div className="mt-2 p-3 rounded-lg bg-navy-600/25 border border-navy-500/30">
                              <p className="text-xs text-gray-300 leading-relaxed">
                                {newsDateRange
                                  ? `This score is the conclusion of ${newsDateRange.count} article${newsDateRange.count !== 1 ? 's' : ''} from the last ${daySpan} day${daySpan !== 1 ? 's' : ''}. The sentiment agent analyzes recent news headlines and summaries to gauge market sentiment for this asset.`
                                  : 'This score reflects the overall sentiment derived from recent news coverage. No recent articles were found for this ticker.'}
                              </p>
                            </div>
                          </div>
                        )}
                        {/* Regime Info — collapsible */}
                        {s.agentType === 'market_regime' && (
                          <div
                            className="overflow-hidden transition-all duration-300 ease-in-out"
                            style={{
                              maxHeight: showRegimeInfo ? '200px' : '0px',
                              opacity: showRegimeInfo ? 1 : 0,
                            }}
                          >
                            <div className="mt-2 p-3 rounded-lg bg-navy-600/25 border border-navy-500/30">
                              <p className="text-xs text-gray-300 leading-relaxed">
                                {isCrypto
                                  ? 'The market regime score evaluates broad crypto market conditions by analyzing BTC and ETH price trends, volatility, and momentum. It is a shared signal applied to all crypto assets.'
                                  : 'The market regime score evaluates broad stock market conditions by analyzing SPY, XLK, and XLV price trends, volatility, and momentum. It is a shared signal applied to all stock and ETF assets.'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              );
            })()}

            {/* Sentiment Explanation */}
            {sentimentScore?.explanation && (
              <LabeledBlock agent="sentiment">
                <h3 className="text-sm font-medium text-gray-400 mb-2">Sentiment Analysis</h3>
                <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{sentimentScore.explanation}</p>
              </LabeledBlock>
            )}

            {/* Fundamentals */}
            {fundamentals && (
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-3">Fundamentals</h3>
                <div className="grid grid-cols-3 gap-3">
                  {fundamentals.marketCap != null && (
                    <FundamentalStat label="Market Cap" value={formatLargeNumber(fundamentals.marketCap)} />
                  )}
                  {fundamentals.peRatio != null && (
                    <FundamentalStat label="P/E Ratio" value={fundamentals.peRatio.toFixed(1)} />
                  )}
                  {fundamentals.psRatio != null && (
                    <FundamentalStat label="P/S Ratio" value={fundamentals.psRatio.toFixed(1)} />
                  )}
                  {fundamentals.revenueGrowthYoy != null && (
                    <FundamentalStat label="Rev Growth YoY" value={formatPct(fundamentals.revenueGrowthYoy)} />
                  )}
                  {fundamentals.profitMargin != null && (
                    <FundamentalStat label="Profit Margin" value={formatPct(fundamentals.profitMargin)} />
                  )}
                  {fundamentals.roe != null && (
                    <FundamentalStat label="ROE" value={formatPct(fundamentals.roe)} />
                  )}
                  {fundamentals.debtToEquity != null && (
                    <FundamentalStat label="Debt/Equity" value={fundamentals.debtToEquity.toFixed(2)} />
                  )}
                </div>
              </div>
            )}

            {/* News */}
            {news.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-gray-400 mb-3">Recent News</h3>
                <div className="space-y-2">
                  {news.map((item) => (
                    <a
                      key={item.id}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block bg-navy-700/30 rounded-lg px-4 py-3 hover:bg-navy-700/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-gray-200 font-medium leading-snug">{item.headline}</p>
                          {item.summary && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.summary}</p>
                          )}
                          <p className="text-xs text-gray-600 mt-1">
                            {item.source} &middot; {new Date(item.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                        <ExternalLink className="h-3.5 w-3.5 text-gray-600 shrink-0 mt-1" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {loadingData && scores.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">Loading data...</div>
            )}
          </div>
        </div>
      </div>

      {/* Buy Modal */}
      <Modal open={showBuyModal} onClose={() => { setShowBuyModal(false); setBuyAmount(''); }} title={`Buy ${name}`}>
        <div className="space-y-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm text-gray-400">Current Price</span>
            <span className="text-lg font-bold text-white">{formatCurrency(buyPrice)}</span>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Investment Amount ($)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span>
              <input
                type="number"
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
                placeholder="e.g. 1000"
                min={1}
                className="w-full pl-7 pr-3 py-2 bg-navy-700 border border-navy-500 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent-blue"
                autoFocus
              />
            </div>
          </div>
          {quantity > 0 && (
            <p className="text-xs text-gray-500">
              &asymp; {quantity.toFixed(quantity >= 1 ? 2 : 6)} shares at {formatCurrency(buyPrice)}/share
            </p>
          )}
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => { setShowBuyModal(false); setBuyAmount(''); }}>Cancel</Button>
            <Button onClick={handleBuy} disabled={quantity <= 0}>
              Confirm Buy
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function FundamentalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-navy-700/30 rounded-lg px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm font-medium text-white">{value}</p>
    </div>
  );
}
