'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useSimulation } from '@/components/simulation-provider';
import { SimulationBanner } from '@/components/simulation-banner';
import { DataFreshnessBar } from '@/components/data-freshness-bar';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Labeled } from '@/components/ui/agent-badge';
import { TickerDetailModal } from '@/components/market/ticker-detail-modal';
import { formatCurrency, formatPct, formatScore, computeGoalProbability } from '@/lib/formatters';
import {
  getAllAgentScoresGrouped,
  getAllQuotes,
  getAllMarketCaps,
  getPortfolio,
  addPortfolioPosition,
  getPortfolioPositions,
  upsertPortfolioValuation,
  getUserProfile,
  getLatestPrices,
} from '@/lib/queries';
import type { AgentScore } from '@shared/types/scores';
import type { TickerQuote } from '@/lib/queries';
import { ASSET_UNIVERSE, ASSET_TYPE_MAP, getWeightsForTicker } from '@shared/lib/constants';
import { Search, BarChart3, ArrowUpDown, LayoutGrid, Settings } from 'lucide-react';
import Link from 'next/link';

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
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return formatCurrency(n);
}

function scoreBg(score: number): string {
  if (score >= 0.6) return 'bg-emerald-500/20 text-emerald-400 ring-emerald-500/30';
  if (score >= 0.2) return 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20';
  if (score <= -0.6) return 'bg-red-500/20 text-red-400 ring-red-500/30';
  if (score <= -0.2) return 'bg-red-500/10 text-red-400 ring-red-500/20';
  return 'bg-gray-500/10 text-gray-400 ring-gray-500/20';
}

type SortField = 'ticker' | 'price' | 'change' | 'composite' | 'technical' | 'sentiment' | 'fundamental';
type FilterType = 'all' | 'stock' | 'etf' | 'crypto';

export default function MarketPage() {
  const { user, supabase, loading: authLoading, isGuest } = useAuth();
  const { isSimulation, simulationDate } = useSimulation();
  const asOfDate = isSimulation ? simulationDate ?? undefined : undefined;

  const [loading, setLoading] = useState(true);
  const [allScores, setAllScores] = useState<Record<string, AgentScore[]>>({});
  const [allQuotes, setAllQuotes] = useState<Record<string, TickerQuote>>({});
  const [allMarketCaps, setAllMarketCaps] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [sortField, setSortField] = useState<SortField>('composite');
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getAllAgentScoresGrouped(supabase, asOfDate),
      getAllQuotes(supabase, asOfDate),
      getAllMarketCaps(supabase, asOfDate),
    ])
      .then(([scores, quotes, caps]) => {
        setAllScores(scores);
        setAllQuotes(quotes);
        setAllMarketCaps(caps);
      })
      .catch((err) => console.error('Market data load error:', err))
      .finally(() => setLoading(false));
  }, [supabase, asOfDate]);

  function getScore(ticker: string, agentType: string): number | undefined {
    const scores = allScores[ticker];
    if (!scores) return undefined;
    const match = scores.find((s) => s.agentType === agentType);
    return match?.score;
  }

  function getComposite(ticker: string): number | undefined {
    const scores = allScores[ticker];
    if (!scores || scores.length === 0) return undefined;
    const sentEntry = scores.find((s) => s.agentType === 'sentiment');
    const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
    const sentMissing = isCrypto && (!sentEntry || sentEntry.confidence === 0 || sentEntry.dataFreshness === 'missing');
    const w = getWeightsForTicker(ticker, sentMissing);
    const tech = scores.find((s) => s.agentType === 'technical')?.score ?? 0;
    const sent = sentEntry?.score ?? 0;
    const fund = scores.find((s) => s.agentType === 'fundamental')?.score ?? 0;
    const regime = scores.find((s) => s.agentType === 'market_regime')?.score ?? 0;
    return tech * w.technical + sent * w.sentiment + fund * w.fundamental + regime * w.regime;
  }

  const tickers = useMemo(() => {
    let list = [...ASSET_UNIVERSE];

    if (filter !== 'all') {
      list = list.filter((t) => ASSET_TYPE_MAP[t] === filter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (t) =>
          t.toLowerCase().includes(q) ||
          (ASSET_NAMES[t] ?? '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let va: number | string = 0;
      let vb: number | string = 0;

      switch (sortField) {
        case 'ticker':
          va = a;
          vb = b;
          return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
        case 'price':
          va = allQuotes[a]?.lastPrice ?? 0;
          vb = allQuotes[b]?.lastPrice ?? 0;
          break;
        case 'change':
          va = allQuotes[a]?.pctChange ?? 0;
          vb = allQuotes[b]?.pctChange ?? 0;
          break;
        case 'composite':
          va = getComposite(a) ?? -999;
          vb = getComposite(b) ?? -999;
          break;
        case 'technical':
          va = getScore(a, 'technical') ?? -999;
          vb = getScore(b, 'technical') ?? -999;
          break;
        case 'sentiment':
          va = getScore(a, 'sentiment') ?? -999;
          vb = getScore(b, 'sentiment') ?? -999;
          break;
        case 'fundamental':
          va = getScore(a, 'fundamental') ?? -999;
          vb = getScore(b, 'fundamental') ?? -999;
          break;
      }

      return sortAsc ? (va as number) - (vb as number) : (vb as number) - (va as number);
    });

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, search, sortField, sortAsc, allQuotes, allScores]);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  }

  async function handleBuy(ticker: string, quantity: number, price: number) {
    if (!user) return;

    const feesEnabled = localStorage.getItem('maipa_include_fees') === 'true';
    const effectiveQty = feesEnabled ? quantity * 0.99 : quantity;

    if (isGuest) {
      const stored = sessionStorage.getItem('guest_positions');
      const positions = stored ? JSON.parse(stored) : [];
      positions.push({
        id: crypto.randomUUID(),
        portfolioId: 'guest-portfolio',
        ticker,
        quantity: effectiveQty,
        avgPurchasePrice: price,
        openedAt: new Date().toISOString(),
      });
      sessionStorage.setItem('guest_positions', JSON.stringify(positions));
    } else {
      const portfolio = await getPortfolio(supabase, user.id);
      if (portfolio) {
        await addPortfolioPosition(supabase, portfolio.id, ticker, effectiveQty, price);

        const [positions, profile] = await Promise.all([
          getPortfolioPositions(supabase, portfolio.id),
          getUserProfile(supabase, user.id),
        ]);
        if (profile) {
          const tickerList = positions.map((p) => p.ticker);
          const prices = tickerList.length > 0 ? await getLatestPrices(supabase, tickerList) : {};
          let marketVal = 0;
          let costBasis = 0;
          for (const p of positions) {
            const px = prices[p.ticker] ?? p.avgPurchasePrice;
            marketVal += p.quantity * px;
            costBasis += p.quantity * p.avgPurchasePrice;
          }
          const cash = Math.max(0, profile.investmentCapital - costBasis);
          const totalVal = marketVal + cash;
          const cumReturn = profile.investmentCapital > 0
            ? (totalVal - profile.investmentCapital) / profile.investmentCapital
            : 0;
          const goalProb = computeGoalProbability({
            cumulativeReturn: cumReturn,
            goalReturn: profile.goalReturnPct,
            monthsRemaining: profile.timeHorizonMonths,
            positionCount: positions.length,
            maxPositions: profile.maxPositions,
            riskProfile: profile.riskProfile,
          });
          await upsertPortfolioValuation(supabase, portfolio.id, totalVal, cash, 0, cumReturn, goalProb);
        }
      }
    }
    setSelectedTicker(null);
  }

  if (authLoading || loading) {
    return (
      <main className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" message="Loading market data..." />
      </main>
    );
  }

  const SortHeader = ({ field, label, className = '' }: { field: SortField; label: string; className?: string }) => (
    <button
      onClick={() => toggleSort(field)}
      className={`flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors ${className}`}
    >
      {label}
      {sortField === field && (
        <ArrowUpDown className="h-3 w-3" />
      )}
    </button>
  );

  return (
    <div className="min-h-screen w-full bg-[#0F2036] relative">
      <div
        className="fixed inset-0 z-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, #152a45 1px, transparent 1px),
            linear-gradient(to bottom, #152a45 1px, transparent 1px)
          `,
          backgroundSize: '38px 15px',
          WebkitMaskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)',
          maskImage: 'radial-gradient(ellipse 70% 60% at 50% 0%, #000 60%, transparent 100%)',
        }}
      />
    <SimulationBanner />
    <main className="max-w-7xl mx-auto px-4 py-6 relative z-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-accent-blue" />
          <h1 className="text-xl font-bold text-white">Market</h1>
          <span className="text-xs text-gray-500">(Version 0.73)</span>
          <span className="text-sm text-gray-500">{ASSET_UNIVERSE.length} assets</span>
        </div>
        <div className="flex items-center gap-4">
          <DataFreshnessBar />
          <Link
            href="/dashboard"
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1"
          >
            <LayoutGrid className="h-4 w-4" /> Dashboard
          </Link>
          <Link
            href="/settings"
            className="text-gray-400 hover:text-white transition-colors"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </Link>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-4 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ticker or name..."
            className="w-full pl-9 pr-3 py-2 bg-navy-700 border border-navy-500 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent-blue text-sm"
          />
        </div>
        <div className="flex gap-1">
          {(['all', 'stock', 'etf', 'crypto'] as FilterType[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-accent-blue/20 text-accent-blue'
                  : 'bg-navy-700 text-gray-400 hover:text-gray-300'
              }`}
            >
              {f === 'all' ? 'All' : f === 'etf' ? 'ETFs' : f === 'stock' ? 'Stocks' : 'Crypto'}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card padding="sm">
        {/* Table Header */}
        <div className="grid grid-cols-[1fr_80px_60px_80px_80px_80px_80px_70px] gap-2 px-3 py-2 border-b border-navy-600">
          <SortHeader field="ticker" label="Asset" />
          <SortHeader field="price" label="Price" className="text-right justify-end" />
          <span className="text-xs text-gray-500 text-right">Mkt Cap</span>
          <SortHeader field="change" label="Change" className="text-right justify-end" />
          <SortHeader field="technical" label="Tech. Score" className="text-right justify-end" />
          <SortHeader field="sentiment" label="Sent. Score" className="text-right justify-end" />
          <SortHeader field="fundamental" label="Fund. Score" className="text-right justify-end" />
          <SortHeader field="composite" label="Composite" className="text-right justify-end" />
        </div>

        {/* Rows */}
        <div className="divide-y divide-navy-700/50">
          {tickers.map((ticker) => {
            const quote = allQuotes[ticker];
            const tech = getScore(ticker, 'technical');
            const sent = getScore(ticker, 'sentiment');
            const fund = getScore(ticker, 'fundamental');
            const composite = getComposite(ticker);
            const isUp = (quote?.pctChange ?? 0) >= 0;
            const cap = allMarketCaps[ticker];

            return (
              <button
                key={ticker}
                onClick={() => setSelectedTicker(ticker)}
                className="w-full grid grid-cols-[1fr_80px_60px_80px_80px_80px_80px_70px] gap-2 px-3 py-2 hover:bg-navy-700/30 transition-colors text-left items-center"
              >
                {/* Ticker + Name */}
                <div className="min-w-0">
                  <span className="text-sm font-medium text-white">{ASSET_NAMES[ticker] ?? ticker}</span>
                  <span className="text-[10px] text-gray-500 block leading-tight">{ticker}</span>
                </div>

                {/* Price */}
                <span className="text-sm text-gray-300 text-right">
                  {quote ? formatCurrency(quote.lastPrice) : '—'}
                </span>

                {/* Market Cap */}
                <span className="text-[10px] text-gray-500 text-right">
                  {cap ? formatLargeNumber(cap) : '—'}
                </span>

                {/* Change */}
                <span className={`text-sm text-right ${
                  quote ? (isUp ? 'text-emerald-400' : 'text-red-400') : 'text-gray-600'
                }`}>
                  {quote ? formatPct(quote.pctChange) : '—'}
                </span>

                {/* Technical Score */}
                <span className="text-right">
                  {tech !== undefined ? (
                    <Labeled agent="technical">
                      <span className={`text-sm font-mono ${tech >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatScore(tech)}
                      </span>
                    </Labeled>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </span>

                {/* Sentiment Score */}
                <span className="text-right">
                  {sent !== undefined ? (
                    <Labeled agent="sentiment">
                      <span className={`text-sm font-mono ${sent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatScore(sent)}
                      </span>
                    </Labeled>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </span>

                {/* Fundamental Score */}
                <span className="text-right">
                  {fund !== undefined ? (
                    <Labeled agent="fundamental">
                      <span className={`text-sm font-mono ${fund >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {formatScore(fund)}
                      </span>
                    </Labeled>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </span>

                {/* Composite Score Pill */}
                <span className="flex justify-end">
                  {composite !== undefined ? (
                    <Labeled agent="composite">
                      <span className={`inline-block px-2 py-1 rounded-md ring-1 text-center ${scoreBg(composite)}`}>
                        <span className="text-xs font-bold font-mono leading-none">
                          {formatScore(composite)}
                        </span>
                      </span>
                    </Labeled>
                  ) : (
                    <span className="text-xs text-gray-600">—</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {tickers.length === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">No assets match your search.</div>
        )}
      </Card>

      {/* Ticker Detail Modal */}
      <TickerDetailModal
        open={!!selectedTicker}
        onClose={() => setSelectedTicker(null)}
        ticker={selectedTicker}
        tickerName={selectedTicker ? ASSET_NAMES[selectedTicker] : undefined}
        preloadedPrice={selectedTicker ? allQuotes[selectedTicker]?.lastPrice : undefined}
        onBuy={handleBuy}
        asOfDate={asOfDate}
      />
    </main>
    </div>
  );
}
