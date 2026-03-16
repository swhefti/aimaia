import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ASSET_TYPE_MAP, getWeightsForTicker } from '@shared/lib/constants';
import {
  runOptimizerCore,
  type OptimizerTickerScore,
  type OptimizerUserParams,
} from '@shared/lib/optimizer-core';
import type { AssetType } from '@shared/types/assets';
import type { RiskProfile, VolatilityTolerance } from '@shared/types/portfolio';

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// ---------------------------------------------------------------------------
// Score loading (shared pattern — also used by synthesis job)
// ---------------------------------------------------------------------------

async function loadScoresFromDb(supabase: ReturnType<typeof getServiceSupabase>) {
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

  if (!latestDate) return { scores: [] as OptimizerTickerScore[], latestDate: null };

  const { data: allScoreData } = await supabase
    .from('agent_scores')
    .select('ticker, score, agent_type, confidence, data_freshness')
    .eq('date', latestDate)
    .limit(2000);

  const { data: regimeRows } = await supabase
    .from('agent_scores')
    .select('ticker, score, confidence')
    .in('ticker', ['MARKET', 'MARKET_CRYPTO'])
    .eq('agent_type', 'market_regime')
    .eq('date', latestDate);

  const stockRegime = regimeRows?.find((r) => r.ticker === 'MARKET');
  const cryptoRegime = regimeRows?.find((r) => r.ticker === 'MARKET_CRYPTO');

  const byTicker = new Map<string, {
    technical: number; sentiment: number; fundamental: number; regime: number;
    confidence: number; freshness: 'current' | 'stale' | 'missing';
    sentimentMissing: boolean;
  }>();

  for (const row of allScoreData ?? []) {
    const ticker = row.ticker as string;
    if (ticker === 'MARKET' || ticker === 'MARKET_CRYPTO') continue;

    if (!byTicker.has(ticker)) {
      const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
      const regime = isCrypto ? (cryptoRegime ?? stockRegime) : stockRegime;
      byTicker.set(ticker, {
        technical: 0, sentiment: 0, fundamental: 0,
        regime: regime ? Number(regime.score) : 0,
        confidence: 0, freshness: 'current', sentimentMissing: false,
      });
    }
    const entry = byTicker.get(ticker)!;
    const agentType = row.agent_type as string;
    const score = Number(row.score);
    const conf = Number(row.confidence);
    const fresh = row.data_freshness as 'current' | 'stale' | 'missing';

    if (agentType === 'technical') { entry.technical = score; entry.confidence = Math.max(entry.confidence, conf); }
    else if (agentType === 'sentiment') {
      entry.sentiment = score;
      if (ASSET_TYPE_MAP[ticker] === 'crypto' && (fresh === 'missing' || conf === 0)) entry.sentimentMissing = true;
    }
    else if (agentType === 'fundamental') { entry.fundamental = score; }
    if (fresh === 'missing' || (fresh === 'stale' && entry.freshness !== 'missing')) entry.freshness = fresh;
  }

  const scores: OptimizerTickerScore[] = [];
  for (const [ticker, entry] of byTicker) {
    const w = getWeightsForTicker(ticker, entry.sentimentMissing);
    const composite = entry.technical * w.technical + entry.sentiment * w.sentiment
      + entry.fundamental * w.fundamental + entry.regime * w.regime;
    scores.push({ ticker, compositeScore: composite, confidence: entry.confidence, dataFreshness: entry.freshness });
  }

  return { scores, latestDate };
}

// ---------------------------------------------------------------------------
// Historical volatility loader
// ---------------------------------------------------------------------------

async function loadTickerVolatilities(
  supabase: ReturnType<typeof getServiceSupabase>,
  tickers: string[],
): Promise<Map<string, number>> {
  const vols = new Map<string, number>();
  if (tickers.length === 0) return vols;

  // Fetch recent price history for selected tickers
  const { data } = await supabase
    .from('price_history')
    .select('ticker, close')
    .in('ticker', tickers)
    .order('date', { ascending: true })
    .limit(tickers.length * 120); // ~120 days per ticker

  if (!data || data.length === 0) return vols;

  // Group closes by ticker
  const byTicker = new Map<string, number[]>();
  for (const row of data) {
    const t = row.ticker as string;
    if (!byTicker.has(t)) byTicker.set(t, []);
    byTicker.get(t)!.push(Number(row.close));
  }

  // Compute annualized vol from daily log returns
  for (const [ticker, closes] of byTicker) {
    if (closes.length < 20) continue;
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1]! > 0) returns.push(Math.log(closes[i]! / closes[i - 1]!));
    }
    if (returns.length < 15) continue;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    vols.set(ticker, Math.sqrt(variance * 252));
  }

  return vols;
}

// ---------------------------------------------------------------------------
// API Route
// ---------------------------------------------------------------------------

/**
 * POST /api/optimizer/build
 * Generates an optimizer-based portfolio draft for onboarding or re-optimization.
 * Uses the shared optimizer core — same engine as daily management.
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

    // 1. Load scores
    const { scores: allScores, latestDate } = await loadScoresFromDb(supabase);
    if (!latestDate || allScores.length === 0) {
      return NextResponse.json({ error: 'No score data available yet. Please wait for the daily analysis pipeline to run.' }, { status: 503 });
    }

    // 2. Apply exclude/allow filters
    const excludeSet = new Set(excludeTickers ?? []);
    const allowedSet = allowedTickers ? new Set(allowedTickers) : null;
    const filteredScores = allScores.filter((s) => {
      if (excludeSet.has(s.ticker)) return false;
      if (allowedSet && !allowedSet.has(s.ticker)) return false;
      return true;
    });

    // 3. Fetch prices
    const prices: Record<string, number> = {};
    const { data: priceData } = await supabase
      .from('market_quotes')
      .select('ticker, last_price')
      .order('date', { ascending: false })
      .limit(2000);
    for (const row of priceData ?? []) {
      const t = row.ticker as string;
      if (!prices[t]) prices[t] = Number(row.last_price);
    }
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

    // Filter scores to only those with valid prices
    const pricedScores = filteredScores.filter((s) => prices[s.ticker] && prices[s.ticker]! > 0);

    // 4. Run shared optimizer core (no current holdings for onboarding)
    const userParams: OptimizerUserParams = {
      maxPositions, assetTypes, riskProfile, volatilityTolerance, goalReturnPct, maxDrawdownLimitPct,
    };

    // Load volatilities for risk metrics
    const candidateTickers = pricedScores.map((s) => s.ticker);
    const tickerVols = await loadTickerVolatilities(supabase, candidateTickers);

    const result = runOptimizerCore(pricedScores, userParams, [], tickerVols);

    // 5. Fetch asset names to enrich response
    const { data: assetData } = await supabase.from('assets').select('ticker, name');
    const assetNames: Record<string, string> = {};
    for (const row of assetData ?? []) assetNames[row.ticker as string] = row.name as string;

    // 6. Enrich target weights with display info
    const enrichedWeights = result.targetWeights.map((tw) => ({
      ...tw,
      name: assetNames[tw.ticker] ?? tw.ticker,
      assetType: (ASSET_TYPE_MAP[tw.ticker] as string) ?? 'stock',
      score: pricedScores.find((s) => s.ticker === tw.ticker)?.compositeScore ?? 0,
      confidence: pricedScores.find((s) => s.ticker === tw.ticker)?.confidence ?? 0,
      price: prices[tw.ticker] ?? 0,
    }));

    return NextResponse.json({
      targetWeights: enrichedWeights,
      cashWeightPct: result.cashWeightPct,
      riskSummary: result.riskSummary,
      metadata: result.metadata,
    });
  } catch (err) {
    console.error('POST /api/optimizer/build error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
