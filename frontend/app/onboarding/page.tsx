'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth-provider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import {
  upsertUserProfile,
  getAllLatestPrices,
  getAllLatestScores,
  createPortfolio,
  getPortfolio,
  addPortfolioPosition,
  upsertPortfolioValuation,
  setCashBalance,
} from '@/lib/queries';
import { formatCurrency, computeGoalProbability } from '@/lib/formatters';
import { ASSET_TYPE_MAP, ASSET_UNIVERSE, CASH_FLOOR_PCT, MAX_POSITION_PCT } from '@shared/lib/constants';
import type { RiskProfile, VolatilityTolerance } from '@shared/types/portfolio';
import type { AssetType } from '@shared/types/assets';
import {
  X, Check, ChevronRight, Wallet, Clock, Target, Shield,
  BarChart3, Factory, Layers, Sparkles,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = ['Welcome', 'Investment Capital', 'Time Horizon', 'Return Goal', 'Risk Tolerance', 'Asset Types', 'Industries', 'Portfolio Size'];

const INDUSTRIES = [
  { id: 'technology', label: 'Technology', tickers: ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'ADBE', 'CRM', 'NFLX', 'AMD', 'QCOM', 'TXN', 'INTC', 'IBM', 'NOW', 'SNOW', 'PLTR', 'SHOP', 'XLK'] },
  { id: 'finance', label: 'Finance', tickers: ['JPM', 'V', 'MA', 'GS', 'MS', 'BAC', 'PYPL', 'SQ', 'COIN', 'HOOD', 'SOFI', 'XLF'] },
  { id: 'healthcare', label: 'Healthcare', tickers: ['JNJ', 'UNH', 'LLY', 'ABBV', 'MRK', 'XLV'] },
  { id: 'energy', label: 'Energy', tickers: ['XOM', 'XLE', 'USO'] },
  { id: 'consumer', label: 'Consumer & Retail', tickers: ['PG', 'HD', 'PEP', 'KO', 'COST', 'WMT', 'TGT', 'DIS'] },
  { id: 'industrial', label: 'Industrial', tickers: ['HON', 'BA', 'CAT', 'GE', 'XLI'] },
  { id: 'automotive', label: 'Automotive & EV', tickers: ['TSLA', 'F', 'GM', 'RIVN', 'LCID', 'NIO'] },
  { id: 'transport', label: 'Transport & Mobility', tickers: ['UBER', 'LYFT'] },
  { id: 'social', label: 'Social & Gaming', tickers: ['PINS', 'SNAP', 'RBLX'] },
  { id: 'international', label: 'International', tickers: ['BABA', 'JD', 'PDD', 'VEA', 'EEM'] },
  { id: 'crypto', label: 'Cryptocurrency', tickers: ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC', 'LTC', 'BCH', 'ATOM', 'UNI', 'AAVE', 'FIL', 'ICP', 'ALGO', 'XLM', 'VET'] },
  { id: 'bonds', label: 'Bonds & Fixed Income', tickers: ['TLT', 'HYG', 'LQD'] },
  { id: 'commodities', label: 'Commodities', tickers: ['GLD', 'SLV'] },
  { id: 'broad_market', label: 'Broad Market ETFs', tickers: ['SPY', 'QQQ', 'IWM', 'VTI', 'VOO', 'ARKK', 'SCHD'] },
] as const;

function formatHorizon(months: number): string {
  if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const yLabel = `${years} year${years === 1 ? '' : 's'}`;
  if (rem === 0) return yLabel;
  return `${yLabel}, ${rem} mo`;
}

/** Max total return % (as integer) keyed by horizon months */
function getMaxReturnPct(months: number): number {
  if (months <= 1) return 3;
  if (months <= 2) return 5;
  if (months <= 3) return 8;
  if (months <= 6) return 12;
  if (months <= 9) return 16;
  if (months <= 12) return 20;
  if (months <= 24) return 35;
  if (months <= 36) return 50;
  if (months <= 48) return 65;
  return 80;
}

interface ReturnSegment {
  label: string;
  description: string;
  min: number; // inclusive %
  max: number; // exclusive %, except last which is inclusive
}

function getReturnSegments(maxPct: number): ReturnSegment[] {
  // 6 segments dividing the range 1 → maxPct
  const range = maxPct - 1;
  const segSize = range / 6;

  const boundaries = Array.from({ length: 7 }, (_, i) =>
    Math.round(1 + segSize * i)
  );
  // Ensure last boundary equals maxPct
  boundaries[6] = maxPct;

  return [
    {
      label: 'Capital Preservation',
      description: 'Prioritize keeping your capital safe with minimal risk.',
      min: boundaries[0]!,
      max: boundaries[1]!,
    },
    {
      label: 'Conservative Growth',
      description: 'Seek modest, steady returns with low exposure to volatility.',
      min: boundaries[1]!,
      max: boundaries[2]!,
    },
    {
      label: 'Moderate Growth',
      description: 'Balance between growth and stability for reliable compounding.',
      min: boundaries[2]!,
      max: boundaries[3]!,
    },
    {
      label: 'Growth',
      description: 'Target above-average returns, accepting moderate market swings.',
      min: boundaries[3]!,
      max: boundaries[4]!,
    },
    {
      label: 'Aggressive Growth',
      description: 'Pursue high returns with willingness to endure significant drawdowns.',
      min: boundaries[4]!,
      max: boundaries[5]!,
    },
    {
      label: 'Maximum Growth',
      description: 'Maximize returns at all costs, comfortable with high risk and large swings.',
      min: boundaries[5]!,
      max: boundaries[6]!,
    },
  ];
}

function getSegmentForReturn(pct: number, segments: ReturnSegment[]): ReturnSegment {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (pct >= segments[i]!.min) return segments[i]!;
  }
  return segments[0]!;
}

function annualizedReturn(totalPct: number, months: number): number {
  if (months <= 0) return 0;
  const r = totalPct / 100;
  return (Math.pow(1 + r, 12 / months) - 1) * 100;
}

function deriveRiskProfile(returnPct: number, maxPct: number): RiskProfile {
  const ratio = returnPct / maxPct;
  if (ratio < 0.25) return 'conservative';
  if (ratio < 0.55) return 'balanced';
  return 'aggressive';
}

// ---------------------------------------------------------------------------
// Recommendation engine (client-side)
// ---------------------------------------------------------------------------

interface PortfolioRecommendation {
  ticker: string;
  name: string;
  assetType: string;
  score: number;
  allocationPct: number; // 0–100
  reasoning: string;
  price: number;
}

function generateRecommendations(
  scores: Record<string, number>,
  prices: Record<string, number>,
  capital: number,
  maxPositions: number,
  riskProfile: RiskProfile,
  returnGoalPct: number,
  horizonMonths: number,
  allowedAssetTypes?: AssetType[],
  allowedTickers?: Set<string>,
): PortfolioRecommendation[] {
  // Asset names (basic mapping for display)
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

  const hasScores = Object.keys(scores).length > 0;
  const hasPrices = Object.keys(prices).length > 0;

  // Hardcoded fallback prices (last resort when market_quotes is empty)
  const FALLBACK_PRICES: Record<string, number> = {
    SPY: 520, QQQ: 450, AAPL: 185, MSFT: 420, GOOGL: 155, VOO: 480,
    VTI: 260, GLD: 195, AMZN: 185, NVDA: 880, META: 510, JNJ: 155,
    BTC: 68000, ETH: 3600, AVGO: 170, NFLX: 620, AMD: 160, TSLA: 175,
  };

  // Helper: resolve price for a ticker
  const getPrice = (t: string): number | undefined => {
    const p = prices[t] ?? FALLBACK_PRICES[t];
    return p && p > 0 ? p : undefined;
  };

  // Build candidate pool: every ticker that passes user preference filters
  // AND has at least a price (score can be missing — we'll use 0)
  const allFiltered = ASSET_UNIVERSE.filter((t) => {
    if (!getPrice(t)) return false;
    if (allowedAssetTypes && allowedAssetTypes.length > 0) {
      const type = ASSET_TYPE_MAP[t] ?? 'stock';
      if (!allowedAssetTypes.includes(type as AssetType)) return false;
    }
    if (allowedTickers && allowedTickers.size > 0 && !allowedTickers.has(t)) return false;
    return true;
  });

  // Split into scored (have real composite score) and unscored
  const scored: { ticker: string; score: number; price: number; type: string }[] = [];
  const unscored: { ticker: string; score: number; price: number; type: string }[] = [];

  for (const t of allFiltered) {
    const entry = {
      ticker: t,
      score: scores[t] ?? 0,
      price: getPrice(t)!,
      type: ASSET_TYPE_MAP[t] ?? 'stock',
    };
    if (scores[t] !== undefined) {
      scored.push(entry);
    } else {
      unscored.push(entry);
    }
  }

  // Sort scored by score descending; unscored stay as-is (universe order)
  scored.sort((a, b) => b.score - a.score);

  // Build selected list: prefer scored candidates, fill remainder with unscored
  const selected = [
    ...scored.slice(0, maxPositions),
    ...unscored.slice(0, Math.max(0, maxPositions - scored.length)),
  ].slice(0, maxPositions);

  // Edge case: no candidates at all (no prices, no data)
  if (selected.length === 0) {
    const defaults = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'GOOGL', 'VOO', 'VTI', 'GLD', 'AMZN', 'NVDA', 'META', 'JNJ'];
    const fallback = defaults.slice(0, maxPositions);
    const equalAlloc = Math.round((100 * (1 - CASH_FLOOR_PCT)) / fallback.length * 10) / 10;
    return fallback.map((ticker) => ({
      ticker,
      name: ASSET_NAMES[ticker] ?? ticker,
      assetType: ASSET_TYPE_MAP[ticker] ?? 'stock',
      score: scores[ticker] ?? 0,
      allocationPct: equalAlloc,
      reasoning: `Recommended as a diversified, well-established ${ASSET_TYPE_MAP[ticker] === 'etf' ? 'ETF' : 'stock'} for your portfolio foundation.${!hasScores ? ' Market scores will be available after the daily analysis pipeline runs.' : ''}`,
      price: getPrice(ticker) ?? FALLBACK_PRICES[ticker] ?? 100,
    }));
  }

  // Allocation: proportional based on score, shifted so all weights are positive
  const investablePct = 100 * (1 - CASH_FLOOR_PCT); // 95%
  const maxSinglePct = MAX_POSITION_PCT * 100; // 30%

  // If all scores are identical (or all unscored), use equal allocation
  const scoreRange = Math.max(...selected.map((c) => c.score)) - Math.min(...selected.map((c) => c.score));
  const useEqualAlloc = scoreRange < 0.01 || !hasScores;

  let allocations: number[];
  if (useEqualAlloc) {
    const equalPct = Math.round((investablePct / selected.length) * 10) / 10;
    allocations = selected.map(() => Math.min(equalPct, maxSinglePct));
  } else {
    // Shift scores so minimum becomes 0.01 (all positive for proportional math)
    const minScore = Math.min(...selected.map((c) => c.score));
    const shift = minScore < 0.01 ? Math.abs(minScore) + 0.01 : 0;
    const shifted = selected.map((c) => c.score + shift);
    const totalShifted = shifted.reduce((sum, s) => sum + s, 0);
    allocations = shifted.map((s) => {
      const raw = (s / totalShifted) * investablePct;
      return Math.round(Math.min(raw, maxSinglePct) * 10) / 10;
    });
  }

  const recs: PortfolioRecommendation[] = selected.map((c, i) => {
    const allocationPct = allocations[i]!;
    const signal = c.score >= 0.6 ? 'Strong Buy' : c.score >= 0.2 ? 'Buy'
      : c.score >= -0.19 ? 'Hold' : c.score >= -0.59 ? 'Sell' : 'Strong Sell';
    const typeLabel = c.type === 'etf' ? 'ETF' : c.type === 'crypto' ? 'cryptocurrency' : 'stock';
    const hasRealScore = scores[c.ticker] !== undefined;

    let reasoning = '';
    if (!hasRealScore) {
      reasoning = `${ASSET_NAMES[c.ticker] ?? c.ticker} is a well-established ${typeLabel} selected for portfolio diversification. AI scores will be available after the analysis pipeline runs. `;
    } else if (c.score >= 0.6) {
      reasoning = `${ASSET_NAMES[c.ticker] ?? c.ticker} shows strong bullish signals across technical and fundamental analysis (score: ${c.score.toFixed(2)}). `;
    } else if (c.score >= 0.2) {
      reasoning = `${ASSET_NAMES[c.ticker] ?? c.ticker} has positive momentum with a composite score of ${c.score.toFixed(2)}. `;
    } else if (c.score >= -0.19) {
      reasoning = `${ASSET_NAMES[c.ticker] ?? c.ticker} is a neutral pick among the top-ranked options (score: ${c.score.toFixed(2)}). `;
    } else {
      reasoning = `${ASSET_NAMES[c.ticker] ?? c.ticker} is the best available candidate in the current market (score: ${c.score.toFixed(2)}). `;
    }

    if (riskProfile === 'conservative') {
      reasoning += `As a ${typeLabel}, it aligns with your conservative approach and ${horizonMonths >= 12 ? 'long' : 'short'}-term horizon. `;
    } else if (riskProfile === 'aggressive') {
      reasoning += `This ${typeLabel} fits your growth-oriented strategy targeting ${returnGoalPct}% total return. `;
    } else {
      reasoning += `This ${typeLabel} balances growth potential with reasonable risk for your ${returnGoalPct}% return target. `;
    }

    reasoning += `Signal: ${signal}. Suggested allocation: ${allocationPct.toFixed(1)}%.`;

    return {
      ticker: c.ticker,
      name: ASSET_NAMES[c.ticker] ?? c.ticker,
      assetType: c.type,
      score: c.score,
      allocationPct,
      reasoning,
      price: c.price,
    };
  });

  return recs;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  const { user, supabase, isGuest } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1: Capital
  const [capital, setCapital] = useState(10000);

  // Step 2: Horizon
  const [horizonMonths, setHorizonMonths] = useState(12); // default: 1 year

  // Step 3: Return Goal
  const maxReturnPct = getMaxReturnPct(horizonMonths);
  const [returnGoalPct, setReturnGoalPct] = useState(Math.round((maxReturnPct / 3) * 10) / 10);
  const segments = getReturnSegments(maxReturnPct);
  const activeSegment = getSegmentForReturn(returnGoalPct, segments);
  const annualized = annualizedReturn(returnGoalPct, horizonMonths);

  // Clamp return goal when horizon changes
  const prevMaxRef = useRef(maxReturnPct);
  useEffect(() => {
    if (maxReturnPct !== prevMaxRef.current) {
      prevMaxRef.current = maxReturnPct;
      setReturnGoalPct((prev) => Math.min(prev, maxReturnPct));
    }
  }, [maxReturnPct]);

  // Step 4: Risk
  const [volatility, setVolatility] = useState<VolatilityTolerance>('balanced');
  const [maxDrawdown, setMaxDrawdown] = useState(0.15);

  // Step 5: Asset Types
  const [assetTypes, setAssetTypes] = useState<AssetType[]>(['stock', 'etf', 'crypto']);

  // Step 6: Industries
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(
    INDUSTRIES.map((i) => i.id)
  );

  // Step 7: Portfolio Size
  const [maxPositions, setMaxPositions] = useState(8);

  // Post-onboarding: recommendation flow
  const [calculating, setCalculating] = useState(false);
  const [calcError, setCalcError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<PortfolioRecommendation[]>([]);
  const [currentRecIdx, setCurrentRecIdx] = useState(0);
  const [approvedPositions, setApprovedPositions] = useState<
    { ticker: string; allocationPct: number; price: number; quantity?: number }[]
  >([]);
  const [adjustedAllocation, setAdjustedAllocation] = useState(0);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [approveSaving, setApproveSaving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const portfolioIdRef = useRef<string | null>(null);
  const investedValueRef = useRef(0);

  const riskProfile = deriveRiskProfile(returnGoalPct, maxReturnPct);

  // Capitalize label helper
  const capitalLabel = useCallback((v: number) => {
    if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    return `$${v}`;
  }, []);

  async function handleCalculate() {
    if (!user) return;
    setSaving(true);
    setCalculating(true);
    setCalcError(null);

    try {
      const profileData = {
        investmentCapital: capital,
        timeHorizonMonths: horizonMonths,
        riskProfile,
        goalReturnPct: returnGoalPct / 100,
        maxDrawdownLimitPct: maxDrawdown,
        volatilityTolerance: volatility,
        assetTypes,
        maxPositions,
        rebalancingPreference: 'daily' as const,
      };

      if (isGuest) {
        sessionStorage.setItem('guest_profile', JSON.stringify({
          userId: 'guest-local',
          ...profileData,
          onboardingCompletedAt: new Date().toISOString(),
        }));
      } else {
        // Save profile — required before portfolio creation (FK constraint)
        try {
          await upsertUserProfile(supabase, user.id, profileData);
        } catch {
          // Retry once after short delay
          try {
            await new Promise((r) => setTimeout(r, 500));
            await upsertUserProfile(supabase, user.id, profileData);
          } catch (retryErr) {
            console.error('Profile save failed after retry:', retryErr);
            setCalcError('Could not save your profile. Please try again.');
            setSaving(false);
            setCalculating(false);
            return;
          }
        }
      }

      // Fetch scores and prices independently — don't let one failure kill both
      let scores: Record<string, number> = {};
      let prices: Record<string, number> = {};
      try {
        scores = await getAllLatestScores(supabase);
      } catch (err) {
        console.error('Failed to load scores:', err);
      }
      try {
        prices = await getAllLatestPrices(supabase);
      } catch (err) {
        console.error('Failed to load prices:', err);
      }

      // Verify auth session is active before DB writes
      if (!isGuest) {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          setCalcError('Your session has expired. Please log in again.');
          setSaving(false);
          setCalculating(false);
          return;
        }
      }

      // Create portfolio upfront so positions can be saved immediately on approve
      if (!isGuest) {
        // First check if an active portfolio already exists
        const existing = await getPortfolio(supabase, user.id);
        if (existing) {
          portfolioIdRef.current = existing.id;
        } else {
          try {
            const newPortfolioId = await createPortfolio(supabase, user.id, 'My Portfolio');
            portfolioIdRef.current = newPortfolioId;
          } catch (createErr) {
            console.error('Failed to create portfolio:', createErr);
            // Retry once after short delay
            try {
              await new Promise((r) => setTimeout(r, 500));
              const retryId = await createPortfolio(supabase, user.id, 'My Portfolio');
              portfolioIdRef.current = retryId;
            } catch (retryErr) {
              console.error('Portfolio creation retry failed:', retryErr);
            }
          }
        }

        if (!portfolioIdRef.current) {
          setCalcError('Could not create portfolio. Please try again.');
          setSaving(false);
          setCalculating(false);
          return;
        }
      }

      // Build allowed tickers from selected industries and asset types
      const industryTickers = new Set<string>();
      for (const ind of INDUSTRIES) {
        if (selectedIndustries.includes(ind.id)) {
          for (const t of ind.tickers) industryTickers.add(t);
        }
      }

      const recs = generateRecommendations(
        scores, prices, capital, maxPositions,
        riskProfile, returnGoalPct, horizonMonths,
        assetTypes, industryTickers,
      );

      setRecommendations(recs);
      setCurrentRecIdx(0);
      if (recs.length > 0) {
        setAdjustedAllocation(recs[0]!.allocationPct);
      }
      setShowRecommendations(true);
    } catch (err) {
      console.error('Calculation error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      setCalcError(`Error: ${msg}`);
    } finally {
      setSaving(false);
      setCalculating(false);
    }
  }

  async function handleApproveRec() {
    const rec = recommendations[currentRecIdx];
    if (!rec || !user || approveSaving) return;

    setApproveSaving(true);
    setApproveError(null);

    const allocationPct = adjustedAllocation;
    const investAmount = capital * (allocationPct / 100);
    const quantity = investAmount / rec.price;

    // Save position for guests in sessionStorage
    if (isGuest) {
      const existingRaw = sessionStorage.getItem('guest_positions');
      const existing = existingRaw ? JSON.parse(existingRaw) : [];
      existing.push({
        id: crypto.randomUUID(),
        portfolioId: 'guest-portfolio',
        ticker: rec.ticker,
        quantity,
        avgPurchasePrice: rec.price,
        openedAt: new Date().toISOString(),
      });
      sessionStorage.setItem('guest_positions', JSON.stringify(existing));
    }
    // For real users, positions are batched and saved in finishOnboarding

    investedValueRef.current += investAmount;
    setApprovedPositions((prev) => [
      ...prev,
      { ticker: rec.ticker, allocationPct, price: rec.price, quantity },
    ]);
    setApproveSaving(false);
    advanceToNext();
  }

  function handleDismissRec() {
    advanceToNext();
  }

  function advanceToNext() {
    const nextIdx = currentRecIdx + 1;
    if (nextIdx < recommendations.length) {
      setCurrentRecIdx(nextIdx);
      setAdjustedAllocation(recommendations[nextIdx]!.allocationPct);
    } else {
      // All done — save and go to dashboard
      finishOnboarding();
    }
  }

  async function finishOnboarding() {
    if (!user) return;
    setCalculating(true);

    try {
      if (!isGuest && portfolioIdRef.current) {
        // Save all approved positions via API route (uses service role, bypasses RLS)
        if (approvedPositions.length > 0) {
          const positionsPayload = approvedPositions
            .filter((p) => p.quantity && p.quantity > 0)
            .map((p) => ({
              ticker: p.ticker,
              quantity: p.quantity!,
              avgPurchasePrice: p.price,
            }));

          if (positionsPayload.length > 0) {
            const res = await fetch('/api/portfolio/positions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                portfolioId: portfolioIdRef.current,
                userId: user.id,
                positions: positionsPayload,
              }),
            });

            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              console.error('Position save API error:', errBody);
              // Fall back to direct insert
              for (const p of positionsPayload) {
                try {
                  await addPortfolioPosition(supabase, portfolioIdRef.current!, p.ticker, p.quantity, p.avgPurchasePrice);
                } catch (err) {
                  console.error('Fallback position save failed:', p.ticker, err);
                }
              }
            } else {
              const result = await res.json();
              console.log('Positions saved via API:', result.saved);
            }
          }
        }

        // Update cash balance and valuation
        const cashValue = capital - investedValueRef.current;
        await setCashBalance(supabase, portfolioIdRef.current!, Math.max(0, cashValue)).catch((err) => {
          console.error('setCashBalance error:', err);
        });
        const initProb = computeGoalProbability({
          cumulativeReturn: 0,
          goalReturn: returnGoalPct / 100,
          monthsRemaining: horizonMonths,
          positionCount: approvedPositions.length,
          maxPositions,
          riskProfile,
        });
        await upsertPortfolioValuation(supabase, portfolioIdRef.current!, capital, cashValue, 0, 0, initProb).catch((err) => {
          console.error('upsertPortfolioValuation error:', err);
        });
      }

      // Mark onboarding as completed
      if (!isGuest) {
        await supabase.from('user_profiles')
          .update({ onboarding_completed_at: new Date().toISOString() })
          .eq('user_id', user.id);
      }

      router.push('/dashboard');
    } catch (err) {
      console.error('Finish error:', err);
      router.push('/dashboard');
    } finally {
      setCalculating(false);
    }
  }

  // Current recommendation for the modal
  const currentRec = recommendations[currentRecIdx];

  // Slider tick marks for capital
  const capitalTicks = [100, 1000, 5000, 10000, 25000, 50000, 100000];

  return (
    <main className="flex items-center justify-center min-h-screen px-4 py-8">
      <div className="w-full max-w-lg">
        {!showRecommendations ? (
          <>
            {/* Progress — hidden on welcome step */}
            {step > 0 && (
              <div className="mb-8">
                <div className="flex justify-between text-sm text-gray-400 mb-2">
                  <span>Step {step} of {STEPS.length - 1}</span>
                  <span>{STEPS[step]}</span>
                </div>
                <div className="w-full h-1.5 bg-navy-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent-blue rounded-full transition-all duration-300"
                    style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Step 0: Welcome */}
            {step === 0 && (
              <Card padding="lg">
                <div className="space-y-6 text-center py-4">
                  <Sparkles className="h-12 w-12 text-accent-blue mx-auto" />
                  <div>
                    <h1 className="text-2xl font-bold text-white">
                      Welcome{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name.split(' ')[0]}` : ''}!
                    </h1>
                    <p className="text-gray-400 mt-3 leading-relaxed max-w-md mx-auto">
                      MAIPA is your AI-powered portfolio advisor. It analyzes 100 assets daily — stocks, ETFs, and crypto — and delivers personalized recommendations based on your goals and risk tolerance.
                    </p>
                    <p className="text-gray-500 text-sm mt-2">
                      Answer a few quick questions so we can build your ideal portfolio.
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-4 pt-2">
                    <Button size="lg" onClick={() => setStep(1)}>
                      Build Portfolio <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                    <button
                      onClick={() => {
                        // Mark onboarding as completed and go to dashboard without positions
                        if (!isGuest && user) {
                          supabase.from('user_profiles')
                            .upsert({
                              user_id: user.id,
                              onboarding_completed_at: new Date().toISOString(),
                              investment_capital: 10000,
                              time_horizon_months: 12,
                              risk_profile: 'balanced',
                              goal_return_pct: 0.07,
                              max_drawdown_limit_pct: 15,
                              volatility_tolerance: 'balanced',
                              max_positions: 8,
                            }, { onConflict: 'user_id' })
                            .then(() => router.push('/dashboard'));
                        } else {
                          router.push('/dashboard');
                        }
                      }}
                      className="text-sm text-gray-400 hover:text-gray-300 transition-colors underline underline-offset-2"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              </Card>
            )}

            {step > 0 && (
            <Card padding="lg">
              {/* Step 1: Investment Capital */}
              {step === 1 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <Wallet className="h-6 w-6 text-accent-blue shrink-0" />
                    <h2 className="text-xl font-semibold text-white">How much are you investing?</h2>
                  </div>
                  <div className="text-center">
                    <span className="text-4xl font-bold text-white">{formatCurrency(capital)}</span>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min={100}
                      max={100000}
                      step={100}
                      value={capital}
                      onChange={(e) => setCapital(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      {capitalTicks.map((v) => (
                        <span key={v}>{capitalLabel(v)}</span>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Time Horizon */}
              {step === 2 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <Clock className="h-6 w-6 text-accent-blue shrink-0" />
                    <div>
                      <h2 className="text-xl font-semibold text-white">What&apos;s your investment horizon?</h2>
                      <p className="text-sm text-gray-400 mt-1">
                        How long do you plan to keep this portfolio active?
                      </p>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-3xl font-bold text-white">
                      {formatHorizon(horizonMonths)}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min={1}
                      max={60}
                      step={1}
                      value={horizonMonths}
                      onChange={(e) => setHorizonMonths(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>1 month</span>
                      <span>5 years</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Return Goal */}
              {step === 3 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <Target className="h-6 w-6 text-accent-blue shrink-0" />
                    <div>
                      <h2 className="text-xl font-semibold text-white">What&apos;s your return goal?</h2>
                      <p className="text-sm text-gray-400 mt-1">
                        Total return on invested capital over your {formatHorizon(horizonMonths)} horizon.
                      </p>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-4xl font-bold text-white">
                      {returnGoalPct >= maxReturnPct ? `${returnGoalPct.toFixed(1)}%+` : `${returnGoalPct.toFixed(1)}%`}
                    </span>
                    <span className="text-sm text-gray-400 ml-2">
                      ({annualized.toFixed(1)}% annualized)
                    </span>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min={0.5}
                      max={maxReturnPct}
                      step={0.1}
                      value={returnGoalPct}
                      onChange={(e) => setReturnGoalPct(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>0.5%</span>
                      <span>{maxReturnPct}%+</span>
                    </div>
                  </div>

                  {/* Active segment description */}
                  <div className="bg-navy-700/50 rounded-lg px-4 py-3 border border-navy-600">
                    <p className="text-sm font-medium text-accent-blue">{activeSegment.label}</p>
                    <p className="text-sm text-gray-300 mt-1">{activeSegment.description}</p>
                  </div>

                  {/* Segment indicators */}
                  <div className="flex gap-1">
                    {segments.map((seg, i) => {
                      const isActive = seg.label === activeSegment.label;
                      return (
                        <div
                          key={i}
                          className={`flex-1 h-1.5 rounded-full transition-colors ${
                            isActive ? 'bg-accent-blue' : 'bg-navy-600'
                          }`}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step 4: Risk Tolerance */}
              {step === 4 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <Shield className="h-6 w-6 text-accent-blue shrink-0" />
                    <div>
                      <h2 className="text-xl font-semibold text-white">How much risk can you handle?</h2>
                      <p className="text-sm text-gray-400 mt-1">
                        This helps us calibrate position sizing and asset selection.
                      </p>
                    </div>
                  </div>

                  {/* Volatility */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Volatility Tolerance
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      How much daily price fluctuation you&apos;re comfortable seeing in your portfolio.
                    </p>
                    <div className="space-y-2">
                      {([
                        { value: 'moderate' as const, label: 'Moderate', desc: 'I prefer stability over returns' },
                        { value: 'balanced' as const, label: 'Balanced', desc: 'I can handle normal market swings' },
                        { value: 'tolerant' as const, label: 'Tolerant', desc: 'Large swings are fine for bigger upside' },
                      ]).map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setVolatility(opt.value)}
                          className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                            volatility === opt.value
                              ? 'border-accent-blue bg-accent-blue/10 text-white'
                              : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'
                          }`}
                        >
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-gray-400 ml-2">— {opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Max Drawdown */}
                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-1">
                      Maximum Drawdown Limit
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      The largest peak-to-trough decline you&apos;d accept before the system moves to protect your capital.
                    </p>
                    <div className="flex gap-2">
                      {[
                        { label: '5%', value: 0.05 },
                        { label: '10%', value: 0.10 },
                        { label: '15%', value: 0.15 },
                        { label: '20%', value: 0.20 },
                        { label: '30%', value: 0.30 },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => setMaxDrawdown(opt.value)}
                          className={`flex-1 px-2 py-2 rounded-lg border text-sm font-medium transition-colors ${
                            maxDrawdown === opt.value
                              ? 'border-accent-blue bg-accent-blue/10 text-white'
                              : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 5: Asset Types */}
              {step === 5 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <BarChart3 className="h-6 w-6 text-accent-blue shrink-0" />
                    <div>
                      <h2 className="text-xl font-semibold text-white">What do you want to invest in?</h2>
                      <p className="text-sm text-gray-400 mt-1">
                        Select which asset types to include in your portfolio.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {([
                      { value: 'stock' as const, label: 'Stocks', desc: 'Individual company shares (AAPL, MSFT, etc.)' },
                      { value: 'etf' as const, label: 'ETFs', desc: 'Diversified funds tracking indices & sectors' },
                      { value: 'crypto' as const, label: 'Crypto', desc: 'Cryptocurrencies (BTC, ETH, SOL, etc.)' },
                    ]).map((opt) => {
                      const selected = assetTypes.includes(opt.value);
                      return (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setAssetTypes((prev) =>
                              selected
                                ? prev.filter((t) => t !== opt.value)
                                : [...prev, opt.value]
                            );
                          }}
                          className={`w-full text-left px-4 py-3 rounded-lg border text-sm transition-colors ${
                            selected
                              ? 'border-accent-blue bg-accent-blue/10 text-white'
                              : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium">{opt.label}</span>
                              <span className="text-gray-400 ml-2">— {opt.desc}</span>
                            </div>
                            {selected && <Check className="h-4 w-4 text-accent-blue shrink-0" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {assetTypes.length === 0 && (
                    <p className="text-sm text-amber-400 text-center">Select at least one asset type.</p>
                  )}
                </div>
              )}

              {/* Step 6: Industries */}
              {step === 6 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <Factory className="h-6 w-6 text-accent-blue shrink-0" />
                    <div>
                      <h2 className="text-xl font-semibold text-white">Which industries interest you?</h2>
                      <p className="text-sm text-gray-400 mt-1">
                        Pick the sectors you want the AI to consider. You can select multiple.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={() => setSelectedIndustries(INDUSTRIES.map((i) => i.id))}
                      className="text-xs text-accent-blue hover:text-accent-blue/80 transition-colors"
                    >
                      Select All
                    </button>
                    <span className="text-gray-600">|</span>
                    <button
                      onClick={() => setSelectedIndustries([])}
                      className="text-xs text-gray-400 hover:text-gray-300 transition-colors"
                    >
                      Clear All
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
                    {INDUSTRIES.map((ind) => {
                      const selected = selectedIndustries.includes(ind.id);
                      // Hide industries that don't match selected asset types
                      const hasMatchingAsset = ind.tickers.some((t) => {
                        const type = ASSET_TYPE_MAP[t] ?? 'stock';
                        return assetTypes.includes(type as AssetType);
                      });
                      if (!hasMatchingAsset) return null;
                      return (
                        <button
                          key={ind.id}
                          onClick={() => {
                            setSelectedIndustries((prev) =>
                              selected
                                ? prev.filter((id) => id !== ind.id)
                                : [...prev, ind.id]
                            );
                          }}
                          className={`text-left px-3 py-2.5 rounded-lg border text-sm transition-colors ${
                            selected
                              ? 'border-accent-blue bg-accent-blue/10 text-white'
                              : 'border-navy-500 bg-navy-700 text-gray-300 hover:border-navy-400'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-medium truncate">{ind.label}</span>
                            {selected && <Check className="h-3.5 w-3.5 text-accent-blue shrink-0" />}
                          </div>
                          <span className="text-xs text-gray-500">{ind.tickers.length} assets</span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedIndustries.length === 0 && (
                    <p className="text-sm text-amber-400 text-center">Select at least one industry.</p>
                  )}
                </div>
              )}

              {/* Step 7: Portfolio Size */}
              {step === 7 && (
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <Layers className="h-6 w-6 text-accent-blue shrink-0" />
                    <div>
                      <h2 className="text-xl font-semibold text-white">How many positions?</h2>
                      <p className="text-sm text-gray-400 mt-1">
                        More positions means broader diversification, but smaller individual allocations.
                      </p>
                    </div>
                  </div>
                  <div className="text-center">
                    <span className="text-4xl font-bold text-white">{maxPositions}</span>
                    <span className="text-sm text-gray-400 ml-2">
                      {maxPositions <= 4 ? 'Focused' : maxPositions <= 8 ? 'Balanced' : 'Broad'}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min={2}
                      max={15}
                      step={1}
                      value={maxPositions}
                      onChange={(e) => setMaxPositions(Number(e.target.value))}
                      className="w-full accent-accent-blue"
                    />
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>2 positions</span>
                      <span>15 positions</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Error message */}
              {calcError && (
                <p className="text-sm text-red-400 text-center mt-4">{calcError}</p>
              )}

              {/* Navigation */}
              <div className="flex justify-between mt-8">
                <Button
                  variant="ghost"
                  onClick={() => setStep((s) => s - 1)}
                  disabled={step <= 1}
                >
                  Back
                </Button>
                {step < STEPS.length - 1 ? (
                  <Button
                    onClick={() => setStep((s) => s + 1)}
                    disabled={(step === 5 && assetTypes.length === 0) || (step === 6 && selectedIndustries.length === 0)}
                  >
                    Next <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                ) : (
                  <Button onClick={handleCalculate} disabled={saving} size="lg">
                    {saving ? 'Calculating...' : 'Calculate my recommended portfolio'}
                  </Button>
                )}
              </div>
            </Card>
            )}
          </>
        ) : calculating && !currentRec ? (
          <div className="flex flex-col items-center gap-4 py-16">
            <Spinner size="lg" message="Building your recommended portfolio..." />
          </div>
        ) : recommendations.length === 0 ? (
          <Card padding="lg">
            <div className="text-center space-y-4 py-8">
              <p className="text-gray-400">No market data available yet to generate recommendations.</p>
              <Button onClick={() => finishOnboarding()}>
                Go to Dashboard
              </Button>
            </div>
          </Card>
        ) : null}

        {/* Recommendation Modal */}
        {showRecommendations && currentRec && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="bg-navy-800 border border-navy-600 rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-navy-600">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-white">
                    Position {currentRecIdx + 1} of {recommendations.length}
                  </h2>
                </div>
                <button
                  onClick={handleDismissRec}
                  className="text-gray-400 hover:text-white transition-colors"
                  aria-label="Dismiss"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Content */}
              <div className="p-6 space-y-5">
                {/* Ticker + Name */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-white">{currentRec.ticker}</h3>
                    <p className="text-sm text-gray-400">{currentRec.name}</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium uppercase ${
                    currentRec.assetType === 'crypto'
                      ? 'bg-purple-500/20 text-purple-400'
                      : currentRec.assetType === 'etf'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-emerald-500/20 text-emerald-400'
                  }`}>
                    {currentRec.assetType}
                  </span>
                </div>

                {/* Score + Price */}
                <div className="flex gap-4">
                  <div className="bg-navy-700/50 rounded-lg px-4 py-3 flex-1">
                    <p className="text-xs text-gray-500 mb-1">AI Score</p>
                    <p className={`text-lg font-bold ${
                      currentRec.score >= 0.6 ? 'text-emerald-400' :
                      currentRec.score >= 0.2 ? 'text-green-400' : 'text-gray-400'
                    }`}>
                      {currentRec.score > 0 ? '+' : ''}{currentRec.score.toFixed(2)}
                    </p>
                  </div>
                  <div className="bg-navy-700/50 rounded-lg px-4 py-3 flex-1">
                    <p className="text-xs text-gray-500 mb-1">Current Price</p>
                    <p className="text-lg font-bold text-white">{formatCurrency(currentRec.price)}</p>
                  </div>
                  <div className="bg-navy-700/50 rounded-lg px-4 py-3 flex-1">
                    <p className="text-xs text-gray-500 mb-1">Amount</p>
                    <p className="text-lg font-bold text-white">
                      {formatCurrency(capital * (adjustedAllocation / 100))}
                    </p>
                  </div>
                </div>

                {/* Reasoning */}
                <div>
                  <p className="text-xs text-gray-500 mb-1">Why this position?</p>
                  <p className="text-sm text-gray-300 leading-relaxed">{currentRec.reasoning}</p>
                </div>

                {/* Allocation adjustment */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs text-gray-500">Suggested Allocation</p>
                    <span className="text-sm font-bold text-white">{adjustedAllocation.toFixed(1)}%</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={Math.min(30, 100 - approvedPositions.reduce((s, p) => s + p.allocationPct, 0))}
                    step={0.5}
                    value={adjustedAllocation}
                    onChange={(e) => setAdjustedAllocation(Number(e.target.value))}
                    className="w-full accent-accent-blue"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>1%</span>
                    <span>{formatCurrency(capital * (adjustedAllocation / 100))} of {formatCurrency(capital)}</span>
                    <span>30%</span>
                  </div>
                </div>

                {/* Error message */}
                {approveError && (
                  <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-3">
                    {approveError}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button
                    size="lg"
                    className="flex-1"
                    onClick={handleApproveRec}
                    disabled={approveSaving}
                  >
                    {approveSaving ? 'Saving...' : <><Check className="h-4 w-4 mr-2" /> Approve</>}
                  </Button>
                  <Button
                    size="lg"
                    variant="ghost"
                    className="flex-1"
                    onClick={handleDismissRec}
                    disabled={approveSaving}
                  >
                    Dismiss
                  </Button>
                </div>

                {/* Running total */}
                {approvedPositions.length > 0 && (
                  <div className="border-t border-navy-600 pt-3">
                    <p className="text-xs text-gray-500 mb-2">
                      Approved so far: {approvedPositions.length} position{approvedPositions.length > 1 ? 's' : ''}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {approvedPositions.map((p) => (
                        <span
                          key={p.ticker}
                          className="px-2 py-1 bg-accent-blue/10 text-accent-blue text-xs rounded-full"
                        >
                          {p.ticker} ({p.allocationPct.toFixed(1)}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Saving overlay */}
              {calculating && (
                <div className="absolute inset-0 bg-navy-800/80 flex items-center justify-center rounded-xl">
                  <Spinner size="lg" message="Setting up your portfolio..." />
                </div>
              )}
            </div>
          </div>
        )}

        {/* After all recs are done (no more currentRec) and we're saving */}
        {showRecommendations && !currentRec && calculating && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
            <div className="bg-navy-800 border border-navy-600 rounded-xl p-8 max-w-sm w-full text-center">
              <Spinner size="lg" message="Setting up your portfolio..." />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
