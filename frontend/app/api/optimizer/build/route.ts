import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ASSET_TYPE_MAP, ASSET_UNIVERSE, getWeightsForTicker } from '@shared/lib/constants';
import type { AssetType } from '@shared/types/assets';
import type { RiskProfile, VolatilityTolerance } from '@shared/types/portfolio';

// ---------------------------------------------------------------------------
// Import optimizer modules (relative paths since backend/ is outside frontend/)
// We inline the core logic here to avoid cross-workspace import issues.
// ---------------------------------------------------------------------------

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ---------------------------------------------------------------------------
// Inline optimizer (self-contained for Next.js API route)
// ---------------------------------------------------------------------------

interface TickerScore {
  ticker: string;
  compositeScore: number;
  confidence: number;
  dataFreshness: 'current' | 'stale' | 'missing';
}

interface TargetWeight {
  ticker: string;
  weightPct: number;
  name: string;
  assetType: string;
  score: number;
  confidence: number;
  price: number;
}

interface BuildResult {
  targetWeights: TargetWeight[];
  cashWeightPct: number;
  riskSummary: {
    expectedReturn: number;
    portfolioVolatility: number;
    concentrationRisk: number;
    diversificationScore: number;
    cryptoAllocationPct: number;
  };
  metadata: {
    candidatesConsidered: number;
    constraintsActive: string[];
  };
}

const MAX_POSITION_PCT = 0.30;
const MAX_CRYPTO_ALLOCATION_PCT = 0.40;
const CASH_FLOOR_PCT = 0.05;
const BASE_RETURN_SCALE = 0.30;

function clamp(v: number, min: number, max: number) { return Math.max(min, Math.min(max, v)); }

function deriveRiskPenalty(riskProfile: RiskProfile, volatilityTolerance: VolatilityTolerance): number {
  let p = 2.0;
  if (riskProfile === 'conservative') p = 4.0;
  else if (riskProfile === 'aggressive') p = 1.0;
  if (volatilityTolerance === 'moderate') p *= 1.3;
  else if (volatilityTolerance === 'tolerant') p *= 0.7;
  return p;
}

function buildPortfolio(
  scores: TickerScore[],
  params: {
    maxPositions: number;
    assetTypes: AssetType[];
    riskProfile: RiskProfile;
    volatilityTolerance: VolatilityTolerance;
    goalReturnPct: number;
  },
  prices: Record<string, number>,
  assetNames: Record<string, string>,
): BuildResult {
  const { maxPositions, assetTypes, riskProfile, volatilityTolerance } = params;
  const constraintsActive: string[] = [];

  // Filter candidates
  const eligible = scores.filter((s) => {
    const type = ASSET_TYPE_MAP[s.ticker] as AssetType | undefined;
    if (!type || !assetTypes.includes(type)) return false;
    if (!prices[s.ticker] || prices[s.ticker]! <= 0) return false;
    return true;
  });

  // Sort by composite score
  eligible.sort((a, b) => b.compositeScore - a.compositeScore);

  // Select top N
  const selected = eligible.slice(0, maxPositions);
  if (selected.length === 0) {
    return {
      targetWeights: [],
      cashWeightPct: 100,
      riskSummary: { expectedReturn: 0, portfolioVolatility: 0, concentrationRisk: 0, diversificationScore: 1, cryptoAllocationPct: 0 },
      metadata: { candidatesConsidered: eligible.length, constraintsActive },
    };
  }

  const investablePct = 100 * (1 - CASH_FLOOR_PCT);
  const maxSinglePct = MAX_POSITION_PCT * 100;
  const riskPenalty = deriveRiskPenalty(riskProfile, volatilityTolerance);

  // Compute expected returns
  const expectedReturns = new Map<string, number>();
  for (const s of selected) {
    let mu = s.compositeScore * BASE_RETURN_SCALE;
    const confMult = s.confidence < 0.3 ? s.confidence / 0.3 * 0.5 : 0.5 + (s.confidence - 0.3) / 0.7 * 0.5;
    mu *= confMult;
    if (s.dataFreshness === 'stale') mu *= 0.7;
    if (s.dataFreshness === 'missing') mu *= 0.3;
    expectedReturns.set(s.ticker, mu);
  }

  // Score-proportional allocation with risk adjustment
  const minMu = Math.min(...selected.map((s) => expectedReturns.get(s.ticker) ?? 0));
  const shift = minMu < 0.001 ? Math.abs(minMu) + 0.001 : 0;
  const shifted = selected.map((s) => (expectedReturns.get(s.ticker) ?? 0) + shift);
  const totalShifted = shifted.reduce((sum, v) => sum + v, 0);

  const equalPct = investablePct / selected.length;
  // Aggressive profiles get more score-proportional allocation
  const scoreBlend = riskProfile === 'aggressive' ? 0.7 : riskProfile === 'conservative' ? 0.3 : 0.5;

  const rawWeights = selected.map((_, i) => {
    const scorePct = totalShifted > 0 ? (shifted[i]! / totalShifted) * investablePct : equalPct;
    return clamp(scorePct * scoreBlend + equalPct * (1 - scoreBlend), 2, maxSinglePct);
  });

  // Normalize to fit investablePct
  const rawTotal = rawWeights.reduce((s, w) => s + w, 0);
  const scale = rawTotal > 0 ? investablePct / rawTotal : 1;
  let weights = rawWeights.map((w) => clamp(w * scale, 2, maxSinglePct));

  // Enforce crypto cap
  let cryptoTotal = 0;
  const cryptoIndices: number[] = [];
  for (let i = 0; i < selected.length; i++) {
    if (ASSET_TYPE_MAP[selected[i]!.ticker] === 'crypto') {
      cryptoTotal += weights[i]!;
      cryptoIndices.push(i);
    }
  }
  const maxCryptoPct = MAX_CRYPTO_ALLOCATION_PCT * 100;
  if (cryptoTotal > maxCryptoPct && cryptoIndices.length > 0) {
    constraintsActive.push('crypto_cap');
    const cryptoScale = maxCryptoPct / cryptoTotal;
    for (const idx of cryptoIndices) {
      weights[idx] = weights[idx]! * cryptoScale;
    }
  }

  // Re-normalize
  const finalTotal = weights.reduce((s, w) => s + w, 0);
  const cashWeightPct = Math.max(100 - finalTotal, CASH_FLOOR_PCT * 100);

  // Build output
  const targetWeights: TargetWeight[] = selected.map((s, i) => ({
    ticker: s.ticker,
    weightPct: Math.round(weights[i]! * 100) / 100,
    name: assetNames[s.ticker] ?? s.ticker,
    assetType: (ASSET_TYPE_MAP[s.ticker] as string) ?? 'stock',
    score: s.compositeScore,
    confidence: s.confidence,
    price: prices[s.ticker] ?? 0,
  })).filter((tw) => tw.weightPct > 0.5);

  targetWeights.sort((a, b) => b.weightPct - a.weightPct);

  // Risk metrics
  let hhi = 0;
  for (const tw of targetWeights) {
    const w = tw.weightPct / 100;
    hhi += w * w;
  }
  const n = targetWeights.length;
  const minHhi = n > 0 ? 1 / n : 0;
  const concentrationRisk = n > 0 && hhi > minHhi ? Math.min(1, (hhi - minHhi) / (1 - minHhi)) : 0;

  let expRet = 0;
  for (const tw of targetWeights) {
    expRet += (tw.weightPct / 100) * (expectedReturns.get(tw.ticker) ?? 0);
  }

  let cryptoAlloc = 0;
  for (const tw of targetWeights) {
    if (ASSET_TYPE_MAP[tw.ticker] === 'crypto') cryptoAlloc += tw.weightPct;
  }

  return {
    targetWeights,
    cashWeightPct: Math.round(cashWeightPct * 100) / 100,
    riskSummary: {
      expectedReturn: expRet,
      portfolioVolatility: 0, // would need historical data
      concentrationRisk,
      diversificationScore: 1 - concentrationRisk,
      cryptoAllocationPct: cryptoAlloc,
    },
    metadata: {
      candidatesConsidered: eligible.length,
      constraintsActive,
    },
  };
}

// ---------------------------------------------------------------------------
// API Route
// ---------------------------------------------------------------------------

/**
 * POST /api/optimizer/build
 * Generates an optimizer-based portfolio draft for onboarding or re-optimization.
 *
 * Body: {
 *   userId: string,
 *   capital: number,
 *   timeHorizonMonths: number,
 *   goalReturnPct: number,     // decimal (0.07 for 7%)
 *   maxDrawdownLimitPct: number, // decimal (0.15 for 15%)
 *   riskProfile: RiskProfile,
 *   volatilityTolerance: VolatilityTolerance,
 *   assetTypes: AssetType[],
 *   maxPositions: number,
 *   allowedTickers?: string[],    // optional industry filter
 *   excludeTickers?: string[],    // optional: tickers to exclude (e.g., user removed)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      userId,
      capital,
      timeHorizonMonths,
      goalReturnPct,
      maxDrawdownLimitPct,
      riskProfile,
      volatilityTolerance,
      assetTypes,
      maxPositions,
      allowedTickers,
      excludeTickers,
    } = body as {
      userId: string;
      capital: number;
      timeHorizonMonths: number;
      goalReturnPct: number;
      maxDrawdownLimitPct: number;
      riskProfile: RiskProfile;
      volatilityTolerance: VolatilityTolerance;
      assetTypes: AssetType[];
      maxPositions: number;
      allowedTickers?: string[];
      excludeTickers?: string[];
    };

    if (!userId || !capital || !assetTypes?.length || !maxPositions) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // 1. Fetch latest scores (same logic as getAllLatestScores)
    const MIN_FULL_RUN = 10;
    const { data: recentRows } = await supabase
      .from('agent_scores')
      .select('date')
      .eq('agent_type', 'technical')
      .order('date', { ascending: false })
      .limit(500);

    let latestDate: string | undefined;
    if (recentRows && recentRows.length > 0) {
      const counts: Record<string, number> = {};
      for (const row of recentRows) {
        const d = row.date as string;
        counts[d] = (counts[d] || 0) + 1;
      }
      const sortedDates = Object.keys(counts).sort((a, b) => b.localeCompare(a));
      latestDate = sortedDates.find((d) => counts[d]! >= MIN_FULL_RUN) ?? sortedDates[0];
    }

    if (!latestDate) {
      return NextResponse.json({ error: 'No score data available yet. Please wait for the daily analysis pipeline to run.' }, { status: 503 });
    }

    // Get all scores for that date
    const { data: allScoreData } = await supabase
      .from('agent_scores')
      .select('ticker, score, agent_type, confidence, data_freshness')
      .eq('date', latestDate)
      .limit(2000);

    // Get regime scores
    const { data: regimeRows } = await supabase
      .from('agent_scores')
      .select('ticker, score, confidence')
      .in('ticker', ['MARKET', 'MARKET_CRYPTO'])
      .eq('agent_type', 'market_regime')
      .eq('date', latestDate);

    const stockRegime = regimeRows?.find((r) => r.ticker === 'MARKET');
    const cryptoRegime = regimeRows?.find((r) => r.ticker === 'MARKET_CRYPTO');

    // Compute composite scores per ticker
    const scoresByTicker = new Map<string, {
      technical: number; sentiment: number; fundamental: number; regime: number;
      confidence: number; freshness: 'current' | 'stale' | 'missing';
      sentimentMissing: boolean;
    }>();

    for (const row of allScoreData ?? []) {
      const ticker = row.ticker as string;
      if (ticker === 'MARKET' || ticker === 'MARKET_CRYPTO') continue;

      if (!scoresByTicker.has(ticker)) {
        const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
        const regime = isCrypto ? (cryptoRegime ?? stockRegime) : stockRegime;
        scoresByTicker.set(ticker, {
          technical: 0, sentiment: 0, fundamental: 0,
          regime: regime ? Number(regime.score) : 0,
          confidence: 0, freshness: 'current', sentimentMissing: false,
        });
      }
      const entry = scoresByTicker.get(ticker)!;
      const agentType = row.agent_type as string;
      const score = Number(row.score);
      const conf = Number(row.confidence);
      const fresh = row.data_freshness as 'current' | 'stale' | 'missing';

      if (agentType === 'technical') { entry.technical = score; entry.confidence = Math.max(entry.confidence, conf); }
      else if (agentType === 'sentiment') {
        entry.sentiment = score;
        if (ASSET_TYPE_MAP[ticker] === 'crypto' && (fresh === 'missing' || conf === 0)) {
          entry.sentimentMissing = true;
        }
      }
      else if (agentType === 'fundamental') { entry.fundamental = score; }
      if (fresh === 'missing' || (fresh === 'stale' && entry.freshness !== 'missing')) entry.freshness = fresh;
    }

    // Build TickerScore array with composite scores
    const tickerScores: TickerScore[] = [];
    const excludeSet = new Set(excludeTickers ?? []);
    const allowedSet = allowedTickers ? new Set(allowedTickers) : null;

    for (const [ticker, entry] of scoresByTicker) {
      if (excludeSet.has(ticker)) continue;
      if (allowedSet && !allowedSet.has(ticker)) continue;

      const w = getWeightsForTicker(ticker, entry.sentimentMissing);
      const composite = entry.technical * w.technical + entry.sentiment * w.sentiment
        + entry.fundamental * w.fundamental + entry.regime * w.regime;

      tickerScores.push({
        ticker,
        compositeScore: composite,
        confidence: entry.confidence,
        dataFreshness: entry.freshness,
      });
    }

    // 2. Fetch prices
    const { data: priceData } = await supabase
      .from('market_quotes')
      .select('ticker, last_price')
      .order('date', { ascending: false })
      .limit(2000);

    const prices: Record<string, number> = {};
    for (const row of priceData ?? []) {
      const t = row.ticker as string;
      if (!prices[t]) prices[t] = Number(row.last_price);
    }

    // Fallback: price_history
    if (Object.keys(prices).length === 0) {
      const { data: histPrices } = await supabase
        .from('price_history')
        .select('ticker, close')
        .order('date', { ascending: false })
        .limit(2000);
      for (const row of histPrices ?? []) {
        const t = row.ticker as string;
        if (!prices[t]) prices[t] = Number(row.close);
      }
    }

    // 3. Fetch asset names
    const { data: assetData } = await supabase.from('assets').select('ticker, name');
    const assetNames: Record<string, string> = {};
    for (const row of assetData ?? []) {
      assetNames[row.ticker as string] = row.name as string;
    }

    // 4. Run optimizer
    const result = buildPortfolio(
      tickerScores,
      { maxPositions, assetTypes, riskProfile, volatilityTolerance, goalReturnPct },
      prices,
      assetNames,
    );

    return NextResponse.json(result);
  } catch (err) {
    console.error('POST /api/optimizer/build error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
