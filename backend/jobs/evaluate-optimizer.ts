#!/usr/bin/env npx tsx
/**
 * Job: Evaluate optimizer performance using historical data.
 *
 * Modes:
 *   --score-outcomes  Track forward returns for ALL scored assets (broad calibration source)
 *   --outcomes        Score live recommendation items against realized returns
 *   --backtest        Walk-forward portfolio simulation over a date range
 *   --calibrate       Compute calibrated score→expected-return mapping from score_outcomes
 *   --all             Run all four modes
 *
 * Usage:
 *   npx tsx backend/jobs/evaluate-optimizer.ts --score-outcomes
 *   npx tsx backend/jobs/evaluate-optimizer.ts --outcomes
 *   npx tsx backend/jobs/evaluate-optimizer.ts --backtest --from 2026-01-01 --to 2026-03-15
 *   npx tsx backend/jobs/evaluate-optimizer.ts --calibrate
 *   npx tsx backend/jobs/evaluate-optimizer.ts --all
 */
import { loadEnv } from './lib/env.js';
loadEnv();

import { getServiceSupabase } from './lib/supabase.js';
import {
  ASSET_TYPE_MAP, ASSET_UNIVERSE, getWeightsForTicker,
  CASH_FLOOR_PCT, MAX_POSITION_PCT, SCORE_THRESHOLDS,
} from '../../shared/lib/constants.js';
import {
  runOptimizerCore,
  type OptimizerTickerScore,
  type OptimizerUserParams,
} from '../../shared/lib/optimizer-core.js';
import type { AssetType } from '../../shared/types/assets.js';

type SB = ReturnType<typeof getServiceSupabase>;

/**
 * Minimum samples per score bucket before calibrated expected return is produced.
 * Below this, the calibration row is written but calibrated_expected_return is null,
 * and the optimizer falls back to heuristic.
 */
const MIN_CALIBRATION_SAMPLES = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreBucket(score: number): string {
  if (score >= SCORE_THRESHOLDS.STRONG_BUY_MIN) return 'strong_buy';
  if (score >= SCORE_THRESHOLDS.BUY_MIN) return 'buy';
  if (score >= SCORE_THRESHOLDS.HOLD_MIN) return 'hold';
  if (score >= SCORE_THRESHOLDS.SELL_MIN) return 'sell';
  return 'strong_sell';
}

function confidenceBucket(conf: number): string {
  if (conf >= 0.7) return 'high';
  if (conf >= 0.4) return 'medium';
  return 'low';
}

function pct(n: number): string { return (n * 100).toFixed(2) + '%'; }

async function getPrice(supabase: SB, ticker: string, date: string): Promise<number | null> {
  const { data } = await supabase
    .from('price_history')
    .select('close')
    .eq('ticker', ticker)
    .lte('date', date)
    .order('date', { ascending: false })
    .limit(1)
    .single();
  return data ? Number(data.close) : null;
}

async function getPriceAfterDays(supabase: SB, ticker: string, baseDate: string, days: number): Promise<number | null> {
  const target = new Date(baseDate);
  target.setDate(target.getDate() + days);
  const end = new Date(target);
  end.setDate(end.getDate() + 4);
  const { data } = await supabase
    .from('price_history')
    .select('close')
    .eq('ticker', ticker)
    .gte('date', target.toISOString().split('T')[0]!)
    .lte('date', end.toISOString().split('T')[0]!)
    .order('date', { ascending: true })
    .limit(1)
    .single();
  return data ? Number(data.close) : null;
}

/**
 * Load true optimizer composite scores for all tickers on a given date.
 * Uses the same blending logic (technical + sentiment + fundamental + regime)
 * as the live optimizer, including crypto sentiment-missing redistribution.
 * Shared by: --score-outcomes, --backtest, --outcomes (via computeCompositeForTicker).
 */
async function loadScoresForDate(supabase: SB, dateStr: string): Promise<OptimizerTickerScore[]> {
  const { data: allScoreData } = await supabase
    .from('agent_scores')
    .select('ticker, score, agent_type, confidence, data_freshness')
    .eq('date', dateStr)
    .limit(2000);

  const { data: regimeRows } = await supabase
    .from('agent_scores')
    .select('ticker, score, confidence')
    .in('ticker', ['MARKET', 'MARKET_CRYPTO'])
    .eq('agent_type', 'market_regime')
    .eq('date', dateStr);

  const stockRegime = regimeRows?.find((r) => r.ticker === 'MARKET');
  const cryptoRegime = regimeRows?.find((r) => r.ticker === 'MARKET_CRYPTO');

  const byTicker = new Map<string, {
    technical: number; sentiment: number; fundamental: number; regime: number;
    confidence: number; freshness: 'current' | 'stale' | 'missing'; sentimentMissing: boolean;
  }>();

  for (const row of allScoreData ?? []) {
    const ticker = row.ticker as string;
    if (ticker === 'MARKET' || ticker === 'MARKET_CRYPTO') continue;
    if (!byTicker.has(ticker)) {
      const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
      const regime = isCrypto ? (cryptoRegime ?? stockRegime) : stockRegime;
      byTicker.set(ticker, { technical: 0, sentiment: 0, fundamental: 0, regime: regime ? Number(regime.score) : 0, confidence: 0, freshness: 'current', sentimentMissing: false });
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

  const result: OptimizerTickerScore[] = [];
  for (const [ticker, entry] of byTicker) {
    const w = getWeightsForTicker(ticker, entry.sentimentMissing);
    const composite = entry.technical * w.technical + entry.sentiment * w.sentiment + entry.fundamental * w.fundamental + entry.regime * w.regime;
    result.push({ ticker, compositeScore: composite, confidence: entry.confidence, dataFreshness: entry.freshness });
  }
  return result;
}

/**
 * Compute true composite score for a single ticker on a date.
 * Used by --outcomes for per-recommendation scoring.
 */
async function computeCompositeForTicker(
  supabase: SB, ticker: string, dateStr: string,
): Promise<{ compositeScore: number; confidence: number; dataFreshness: 'current' | 'stale' | 'missing' } | null> {
  const { data: agentRows } = await supabase
    .from('agent_scores')
    .select('agent_type, score, confidence, data_freshness')
    .eq('ticker', ticker)
    .eq('date', dateStr);
  if (!agentRows || agentRows.length === 0) return null;

  const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
  const regimeTicker = isCrypto ? 'MARKET_CRYPTO' : 'MARKET';
  const { data: regimeRow } = await supabase
    .from('agent_scores').select('score').eq('ticker', regimeTicker)
    .eq('agent_type', 'market_regime').eq('date', dateStr).limit(1).single();
  let regimeScore = regimeRow ? Number(regimeRow.score) : 0;
  if (!regimeRow && isCrypto) {
    const { data: fb } = await supabase
      .from('agent_scores').select('score').eq('ticker', 'MARKET')
      .eq('agent_type', 'market_regime').eq('date', dateStr).limit(1).single();
    if (fb) regimeScore = Number(fb.score);
  }

  let technical = 0, sentiment = 0, fundamental = 0, maxConf = 0;
  let freshness: 'current' | 'stale' | 'missing' = 'current';
  let sentimentMissing = false;
  for (const row of agentRows) {
    const at = row.agent_type as string;
    const s = Number(row.score); const c = Number(row.confidence);
    const f = row.data_freshness as 'current' | 'stale' | 'missing';
    if (at === 'technical') { technical = s; maxConf = Math.max(maxConf, c); }
    else if (at === 'sentiment') { sentiment = s; if (isCrypto && (f === 'missing' || c === 0)) sentimentMissing = true; }
    else if (at === 'fundamental') { fundamental = s; }
    if (f === 'missing' || (f === 'stale' && freshness !== 'missing')) freshness = f;
  }
  const w = getWeightsForTicker(ticker, sentimentMissing);
  return {
    compositeScore: technical * w.technical + sentiment * w.sentiment + fundamental * w.fundamental + regimeScore * w.regime,
    confidence: maxConf, dataFreshness: freshness,
  };
}

// ===========================================================================
// Mode: --score-outcomes  (all-asset forward-return tracking)
// ===========================================================================

async function generateScoreOutcomes(supabase: SB): Promise<void> {
  console.log('[ScoreOutcomes] Generating forward-return outcomes for all scored assets...');

  // Find scoring dates with full pipeline runs
  const MIN_FULL_RUN = 10;
  const { data: dateRows } = await supabase
    .from('agent_scores')
    .select('date')
    .eq('agent_type', 'technical')
    .order('date', { ascending: false })
    .limit(10000);

  const dateCounts = new Map<string, number>();
  for (const r of dateRows ?? []) {
    const d = r.date as string;
    dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1);
  }
  const validDates = [...dateCounts.entries()]
    .filter(([, c]) => c >= MIN_FULL_RUN)
    .map(([d]) => d)
    .sort();

  if (validDates.length === 0) {
    console.log('[ScoreOutcomes] No valid scoring dates found.');
    return;
  }

  // Find dates that already have score_outcomes rows to skip
  const { data: existingRows } = await supabase
    .from('score_outcomes')
    .select('score_date')
    .limit(50000);
  const existingDates = new Map<string, Set<string>>();
  // Actually, we need ticker-level dedup. Let's just check per-date count.
  const datesDone = new Set<string>();
  if (existingRows) {
    const byDate = new Map<string, number>();
    for (const r of existingRows) {
      const d = r.score_date as string;
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
    // Consider a date "done" if we already have >= MIN_FULL_RUN outcomes for it
    for (const [d, c] of byDate) {
      if (c >= MIN_FULL_RUN) datesDone.add(d);
    }
  }

  const datesToProcess = validDates.filter((d) => !datesDone.has(d));
  console.log(`[ScoreOutcomes] ${validDates.length} valid dates, ${datesDone.size} already done, ${datesToProcess.length} to process`);

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const dateStr of datesToProcess) {
    const scores = await loadScoresForDate(supabase, dateStr);
    if (scores.length === 0) continue;

    // Batch price lookups: get SPY benchmark prices for this date
    const spyAtScore = await getPrice(supabase, 'SPY', dateStr);
    const spy1d = await getPriceAfterDays(supabase, 'SPY', dateStr, 1);
    const spy7d = await getPriceAfterDays(supabase, 'SPY', dateStr, 7);
    const spy30d = await getPriceAfterDays(supabase, 'SPY', dateStr, 30);
    const benchReturn1d = spy1d && spyAtScore ? (spy1d - spyAtScore) / spyAtScore : null;
    const benchReturn7d = spy7d && spyAtScore ? (spy7d - spyAtScore) / spyAtScore : null;
    const benchReturn30d = spy30d && spyAtScore ? (spy30d - spyAtScore) / spyAtScore : null;

    const rows: Array<Record<string, unknown>> = [];

    for (const s of scores) {
      const priceAtScore = await getPrice(supabase, s.ticker, dateStr);
      if (!priceAtScore) continue;

      const price1d = await getPriceAfterDays(supabase, s.ticker, dateStr, 1);
      const price7d = await getPriceAfterDays(supabase, s.ticker, dateStr, 7);
      const price30d = await getPriceAfterDays(supabase, s.ticker, dateStr, 30);

      const return1d = price1d ? (price1d - priceAtScore) / priceAtScore : null;
      const return7d = price7d ? (price7d - priceAtScore) / priceAtScore : null;
      const return30d = price30d ? (price30d - priceAtScore) / priceAtScore : null;

      rows.push({
        ticker: s.ticker,
        score_date: dateStr,
        asset_type: ASSET_TYPE_MAP[s.ticker] ?? 'stock',
        composite_score: s.compositeScore,
        confidence: s.confidence,
        data_freshness: s.dataFreshness,
        score_bucket: scoreBucket(s.compositeScore),
        confidence_bucket: confidenceBucket(s.confidence),
        price_at_score: priceAtScore,
        price_1d: price1d,
        price_7d: price7d,
        price_30d: price30d,
        return_1d: return1d,
        return_7d: return7d,
        return_30d: return30d,
        benchmark_return_1d: benchReturn1d,
        benchmark_return_7d: benchReturn7d,
        benchmark_return_30d: benchReturn30d,
        beat_benchmark_7d: return7d !== null && benchReturn7d !== null ? return7d > benchReturn7d : null,
        beat_benchmark_30d: return30d !== null && benchReturn30d !== null ? return30d > benchReturn30d : null,
      });
    }

    // Batch upsert (unique on ticker+score_date)
    if (rows.length > 0) {
      for (let b = 0; b < rows.length; b += 50) {
        const batch = rows.slice(b, b + 50);
        const { error, count } = await supabase
          .from('score_outcomes')
          .upsert(batch, { onConflict: 'ticker,score_date', count: 'exact' });
        if (error) {
          console.error(`  [ScoreOutcomes] Upsert error for ${dateStr}: ${error.message}`);
        } else {
          totalInserted += count ?? batch.length;
        }
      }
    }

    console.log(`  ${dateStr}: ${rows.length} tickers scored`);
  }

  console.log(`[ScoreOutcomes] Done: ${totalInserted} rows upserted, ${totalSkipped} skipped`);
}

// ===========================================================================
// Mode: --outcomes  (recommendation-level forward-return tracking)
// ===========================================================================

async function evaluateOutcomes(supabase: SB): Promise<void> {
  console.log('[Evaluate] Scoring recommendation outcomes...');

  const { data: items } = await supabase
    .from('recommendation_items')
    .select('id, ticker, action, confidence, current_allocation_pct, target_allocation_pct, run_id')
    .order('created_at', { ascending: false })
    .limit(500);

  if (!items || items.length === 0) {
    console.log('[Evaluate] No recommendation items found.');
    return;
  }

  const runIds = [...new Set(items.map((i) => i.run_id as string))];
  const { data: runs } = await supabase.from('recommendation_runs').select('id, run_date').in('id', runIds);
  const runDateMap = new Map<string, string>();
  for (const r of runs ?? []) runDateMap.set(r.id as string, r.run_date as string);

  const { data: existingOutcomes } = await supabase
    .from('recommendation_outcomes')
    .select('recommendation_id')
    .in('recommendation_id', items.map((i) => i.id as string));
  const evaluated = new Set((existingOutcomes ?? []).map((o) => o.recommendation_id as string));

  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    if (evaluated.has(item.id as string)) { skipped++; continue; }
    const runDate = runDateMap.get(item.run_id as string);
    if (!runDate) continue;

    const ticker = item.ticker as string;
    const action = item.action as string;
    const priceAtDecision = await getPrice(supabase, ticker, runDate);
    if (!priceAtDecision) continue;

    const price1d = await getPriceAfterDays(supabase, ticker, runDate, 1);
    const price7d = await getPriceAfterDays(supabase, ticker, runDate, 7);
    const price30d = await getPriceAfterDays(supabase, ticker, runDate, 30);

    const spyAtDecision = await getPrice(supabase, 'SPY', runDate);
    const spy7d = await getPriceAfterDays(supabase, 'SPY', runDate, 7);
    const spy30d = await getPriceAfterDays(supabase, 'SPY', runDate, 30);
    const spy1d = await getPriceAfterDays(supabase, 'SPY', runDate, 1);

    const return1d = price1d ? (price1d - priceAtDecision) / priceAtDecision : null;
    const return7d = price7d ? (price7d - priceAtDecision) / priceAtDecision : null;
    const return30d = price30d ? (price30d - priceAtDecision) / priceAtDecision : null;
    const benchReturn1d = spy1d && spyAtDecision ? (spy1d - spyAtDecision) / spyAtDecision : null;
    const benchReturn7d = spy7d && spyAtDecision ? (spy7d - spyAtDecision) / spyAtDecision : null;
    const benchReturn30d = spy30d && spyAtDecision ? (spy30d - spyAtDecision) / spyAtDecision : null;

    const scoreEntry = await computeCompositeForTicker(supabase, ticker, runDate);
    const compositeScore = scoreEntry?.compositeScore ?? null;
    const confidence = Number(item.confidence ?? 0);
    const freshness = scoreEntry?.dataFreshness ?? 'missing';
    const assetType = ASSET_TYPE_MAP[ticker] ?? 'stock';

    const isBullishAction = action === 'BUY' || action === 'ADD';
    const beatBench7d = return7d !== null && benchReturn7d !== null
      ? (isBullishAction ? return7d > benchReturn7d : return7d < benchReturn7d) : null;
    const beatBench30d = return30d !== null && benchReturn30d !== null
      ? (isBullishAction ? return30d > benchReturn30d : return30d < benchReturn30d) : null;

    const { error } = await supabase.from('recommendation_outcomes').insert({
      recommendation_id: item.id, ticker, run_date: runDate, asset_type: assetType, action,
      composite_score: compositeScore, confidence, data_freshness: freshness,
      current_weight_pct: item.current_allocation_pct, target_weight_pct: item.target_allocation_pct,
      expected_return: compositeScore !== null ? compositeScore * 0.30 : null,
      price_at_decision: priceAtDecision,
      price_1d: price1d, price_7d: price7d, price_30d: price30d,
      return_1d: return1d, return_7d: return7d, return_30d: return30d,
      benchmark_return_1d: benchReturn1d, benchmark_return_7d: benchReturn7d, benchmark_return_30d: benchReturn30d,
      beat_benchmark_7d: beatBench7d, beat_benchmark_30d: beatBench30d,
      score_bucket: compositeScore !== null ? scoreBucket(compositeScore) : null,
      confidence_bucket: confidenceBucket(confidence),
    });
    if (error) console.error(`  Outcome insert error for ${ticker}: ${error.message}`);
    else inserted++;
  }

  console.log(`[Evaluate] Outcomes: ${inserted} scored, ${skipped} already evaluated, ${items.length} total items checked`);
}

// ===========================================================================
// Mode: --backtest  (walk-forward simulation)
// ===========================================================================

async function runBacktest(supabase: SB, fromDate: string, toDate: string): Promise<void> {
  console.log(`[Backtest] Walk-forward from ${fromDate} to ${toDate}`);

  const userParams: OptimizerUserParams = {
    maxPositions: 8, assetTypes: ['stock', 'etf', 'crypto'] as AssetType[],
    riskProfile: 'balanced', volatilityTolerance: 'balanced',
    goalReturnPct: 0.07, maxDrawdownLimitPct: 0.15,
  };

  const { data: scoreDates } = await supabase
    .from('agent_scores').select('date').eq('agent_type', 'technical')
    .gte('date', fromDate).lte('date', toDate).order('date', { ascending: true }).limit(5000);

  const uniqueDates = [...new Set((scoreDates ?? []).map((r) => r.date as string))].sort();
  const dateCounts = new Map<string, number>();
  for (const row of scoreDates ?? []) { const d = row.date as string; dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1); }
  const validDates = uniqueDates.filter((d) => (dateCounts.get(d) ?? 0) >= 10);

  if (validDates.length < 2) { console.log('[Backtest] Not enough scoring dates.'); return; }
  console.log(`[Backtest] ${validDates.length} valid scoring dates`);

  let portfolioValue = 100000; const initialValue = portfolioValue;
  let cash = portfolioValue;
  const holdings = new Map<string, { quantity: number; price: number; weightPct: number }>();
  let peakValue = portfolioValue; let maxDrawdown = 0; let totalTurnover = 0;
  const dailyReturns: number[] = [];
  let totalRecs = 0; let hits7d = 0; let total7d = 0; let hits30d = 0; let total30d = 0;
  const buyReturns7d: number[] = []; const sellReturns7d: number[] = [];

  const spyStart = await getPrice(supabase, 'SPY', validDates[0]!);
  const spyEnd = await getPrice(supabase, 'SPY', validDates[validDates.length - 1]!);

  for (let di = 0; di < validDates.length; di++) {
    const date = validDates[di]!;
    const scores = await loadScoresForDate(supabase, date);
    if (scores.length === 0) continue;

    const prices = new Map<string, number>();
    for (const s of scores) { const p = await getPrice(supabase, s.ticker, date); if (p) prices.set(s.ticker, p); }

    let investedValue = 0;
    for (const [ticker, h] of holdings) {
      const cp = prices.get(ticker) ?? h.price; investedValue += h.quantity * cp; h.price = cp;
    }
    const prevValue = portfolioValue; portfolioValue = investedValue + cash;
    if (di > 0) dailyReturns.push(prevValue > 0 ? (portfolioValue - prevValue) / prevValue : 0);
    if (portfolioValue > peakValue) peakValue = portfolioValue;
    const dd = peakValue > 0 ? (peakValue - portfolioValue) / peakValue : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;

    const currentHoldings = [...holdings.entries()].map(([t, h]) => ({
      ticker: t, quantity: h.quantity, avgPurchasePrice: h.price, currentPrice: h.price,
      currentValue: h.quantity * h.price,
      weightPct: portfolioValue > 0 ? (h.quantity * h.price / portfolioValue) * 100 : 0,
    }));

    const result = runOptimizerCore(scores, userParams, currentHoldings, new Map());
    const actionableRecs = result.actions.filter((a) => a.action !== 'HOLD' && prices.has(a.ticker));
    totalRecs += actionableRecs.length;

    for (const action of actionableRecs) {
      const price = prices.get(action.ticker)!;
      const isBullish = action.action === 'BUY' || action.action === 'ADD';
      const p7 = await getPriceAfterDays(supabase, action.ticker, date, 7);
      const p30 = await getPriceAfterDays(supabase, action.ticker, date, 30);
      if (p7) { const r = (p7 - price) / price; total7d++; if (isBullish) { buyReturns7d.push(r); if (r > 0) hits7d++; } else { sellReturns7d.push(r); if (r < 0) hits7d++; } }
      if (p30) { const r = (p30 - price) / price; total30d++; if (isBullish) { if (r > 0) hits30d++; } else { if (r < 0) hits30d++; } }
    }

    // Execute: cash-generating first, then cash-consuming
    for (const action of actionableRecs.filter((a) => a.action === 'SELL' || a.action === 'REDUCE')) {
      const price = prices.get(action.ticker)!;
      const h = holdings.get(action.ticker); if (!h) continue;
      if (action.action === 'SELL') {
        totalTurnover += (h.quantity * price) / portfolioValue; cash += h.quantity * price; holdings.delete(action.ticker);
      } else {
        const tv = portfolioValue * (action.targetWeightPct / 100);
        const cv = h.quantity * price; const ra = cv - tv;
        if (ra > 0) { totalTurnover += ra / portfolioValue; h.quantity = Math.max(0, h.quantity - ra / price); cash += ra; if (h.quantity < 0.001) holdings.delete(action.ticker); }
      }
    }
    for (const action of actionableRecs.filter((a) => a.action === 'BUY' || a.action === 'ADD')) {
      const price = prices.get(action.ticker)!;
      const tv = portfolioValue * (action.targetWeightPct / 100);
      const ex = holdings.get(action.ticker); const cv = ex ? ex.quantity * price : 0;
      const ba = tv - cv;
      if (ba > 0 && cash >= ba) {
        totalTurnover += ba / portfolioValue; const qty = ba / price;
        if (ex) ex.quantity += qty; else holdings.set(action.ticker, { quantity: qty, price, weightPct: action.targetWeightPct });
        cash -= ba;
      }
    }
  }

  const cumReturn = (portfolioValue - initialValue) / initialValue;
  const tradingDays = dailyReturns.length;
  const annReturn = tradingDays > 0 ? Math.pow(1 + cumReturn, 252 / tradingDays) - 1 : 0;
  const meanDR = dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
  const dVol = dailyReturns.length > 1 ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - meanDR) ** 2, 0) / (dailyReturns.length - 1)) : 0;
  const realVol = dVol * Math.sqrt(252); const sharpe = realVol > 0 ? annReturn / realVol : 0;
  const benchReturn = spyStart && spyEnd ? (spyEnd - spyStart) / spyStart : 0;

  await supabase.from('optimizer_backtest_runs').insert({
    start_date: fromDate, end_date: toDate, risk_profile: userParams.riskProfile,
    asset_types: userParams.assetTypes, max_positions: userParams.maxPositions,
    cumulative_return_pct: cumReturn, annualized_return_pct: annReturn,
    max_drawdown_pct: maxDrawdown, realized_volatility: realVol, sharpe_ratio: sharpe,
    total_turnover: totalTurnover, benchmark_return_pct: benchReturn, excess_return_pct: cumReturn - benchReturn,
    total_recommendations: totalRecs,
    hit_rate_7d: total7d > 0 ? hits7d / total7d : 0, hit_rate_30d: total30d > 0 ? hits30d / total30d : 0,
    avg_return_buy_7d: buyReturns7d.length > 0 ? buyReturns7d.reduce((s, r) => s + r, 0) / buyReturns7d.length : 0,
    avg_return_sell_7d: sellReturns7d.length > 0 ? sellReturns7d.reduce((s, r) => s + r, 0) / sellReturns7d.length : 0,
    config_snapshot: { riskProfile: userParams.riskProfile, maxPositions: userParams.maxPositions },
    report_json: { cumReturn, annReturn, maxDrawdown, realVol, sharpe, benchReturn, totalRecs },
  });

  console.log('\n========== BACKTEST RESULTS ==========');
  console.log(`Period: ${fromDate} to ${toDate} (${tradingDays} days)`);
  console.log(`  Cumulative:  ${pct(cumReturn)} | Annualized: ${pct(annReturn)}`);
  console.log(`  Max DD:      ${pct(maxDrawdown)} | Vol: ${pct(realVol)} | Sharpe: ${sharpe.toFixed(2)}`);
  console.log(`  SPY:         ${pct(benchReturn)} | Excess: ${pct(cumReturn - benchReturn)}`);
  console.log(`  Recs:        ${totalRecs} | Hit 7d: ${pct(total7d > 0 ? hits7d / total7d : 0)} | Hit 30d: ${pct(total30d > 0 ? hits30d / total30d : 0)}`);
  console.log('======================================\n');
}

// ===========================================================================
// Mode: --calibrate  (score→expected-return mapping from score_outcomes)
// ===========================================================================

async function calibrate(supabase: SB): Promise<void> {
  console.log('[Calibrate] Computing calibrated expected-return mapping from score_outcomes...');

  // Primary source: score_outcomes (all-asset, broader dataset)
  const { data: outcomes } = await supabase
    .from('score_outcomes')
    .select('composite_score, confidence, asset_type, return_7d, return_30d, score_bucket')
    .not('return_7d', 'is', null)
    .limit(50000);

  if (!outcomes || outcomes.length === 0) {
    console.log('[Calibrate] No score_outcomes with forward returns found. Run --score-outcomes first.');
    return;
  }

  console.log(`[Calibrate] Analyzing ${outcomes.length} score outcomes`);

  // Bucket analysis
  const buckets = new Map<string, { returns7d: number[]; returns30d: number[]; count: number }>();
  const assetBuckets = new Map<string, { returns7d: number[]; returns30d: number[]; count: number }>();

  for (const o of outcomes) {
    const bucket = o.score_bucket as string ?? 'unknown';
    const assetType = o.asset_type as string ?? 'unknown';

    if (!buckets.has(bucket)) buckets.set(bucket, { returns7d: [], returns30d: [], count: 0 });
    if (!assetBuckets.has(`${bucket}|${assetType}`)) assetBuckets.set(`${bucket}|${assetType}`, { returns7d: [], returns30d: [], count: 0 });

    const entry = buckets.get(bucket)!;
    const assetEntry = assetBuckets.get(`${bucket}|${assetType}`)!;
    entry.count++; assetEntry.count++;

    if (o.return_7d != null) { entry.returns7d.push(Number(o.return_7d)); assetEntry.returns7d.push(Number(o.return_7d)); }
    if (o.return_30d != null) { entry.returns30d.push(Number(o.return_30d)); assetEntry.returns30d.push(Number(o.return_30d)); }
  }

  const rows: Array<{
    score_bucket: string; asset_type: string | null; sample_count: number;
    avg_forward_return_7d: number | null; avg_forward_return_30d: number | null;
    median_forward_return_7d: number | null; hit_rate_7d: number | null;
    hit_rate_30d: number | null; calibrated_expected_return: number | null;
  }> = [];

  console.log('\n========== CALIBRATION RESULTS ==========');
  console.log('Score Bucket     | N    | Avg 7d    | Avg 30d   | Hit 7d | Cal. E[R]  | Gated');
  console.log('-----------------|------|-----------|-----------|--------|------------|------');

  const bucketMidScores: Record<string, number> = {
    strong_buy: 0.80, buy: 0.40, hold: 0, sell: -0.40, strong_sell: -0.80,
  };

  for (const [bucket, data] of buckets) {
    const avg7d = data.returns7d.length > 0 ? data.returns7d.reduce((s, r) => s + r, 0) / data.returns7d.length : null;
    const avg30d = data.returns30d.length > 0 ? data.returns30d.reduce((s, r) => s + r, 0) / data.returns30d.length : null;
    const sorted7d = [...data.returns7d].sort((a, b) => a - b);
    const median7d = sorted7d.length > 0 ? sorted7d[Math.floor(sorted7d.length / 2)]! : null;
    const hitRate7d = data.returns7d.length > 0 ? data.returns7d.filter((r) => r > 0).length / data.returns7d.length : null;
    const hitRate30d = data.returns30d.length > 0 ? data.returns30d.filter((r) => r > 0).length / data.returns30d.length : null;

    const observed30dAnn = avg30d !== null ? avg30d * (252 / 30) : null;
    const observed7dAnn = avg7d !== null ? avg7d * (252 / 7) : null;
    const observedAnn = observed30dAnn ?? observed7dAnn ?? null;
    const heuristicER = (bucketMidScores[bucket] ?? 0) * 0.30;

    // Safety gate: only produce a calibrated value when sample count >= threshold
    const meetsThreshold = data.count >= MIN_CALIBRATION_SAMPLES;
    const calibratedER = meetsThreshold && observedAnn !== null
      ? observedAnn * 0.7 + heuristicER * 0.3
      : null; // null = heuristic fallback, not trusted yet

    rows.push({
      score_bucket: bucket, asset_type: null, sample_count: data.count,
      avg_forward_return_7d: avg7d, avg_forward_return_30d: avg30d,
      median_forward_return_7d: median7d, hit_rate_7d: hitRate7d,
      hit_rate_30d: hitRate30d, calibrated_expected_return: calibratedER,
    });

    const gateLabel = meetsThreshold ? 'OK' : `<${MIN_CALIBRATION_SAMPLES}`;
    const erLabel = calibratedER !== null ? pct(calibratedER) : 'heuristic';
    console.log(
      `${bucket.padEnd(17)}| ${String(data.count).padEnd(5)}| ${avg7d !== null ? pct(avg7d).padEnd(10) : 'N/A       '}| ${avg30d !== null ? pct(avg30d).padEnd(10) : 'N/A       '}| ${hitRate7d !== null ? pct(hitRate7d).padEnd(7) : 'N/A    '}| ${erLabel.padEnd(11)}| ${gateLabel}`
    );
  }
  console.log('=========================================\n');

  // Per-asset-type buckets (informational, no calibrated ER)
  for (const [key, data] of assetBuckets) {
    if (data.count < 3) continue;
    const [bucket, assetType] = key.split('|') as [string, string];
    const avg7d = data.returns7d.length > 0 ? data.returns7d.reduce((s, r) => s + r, 0) / data.returns7d.length : null;
    const avg30d = data.returns30d.length > 0 ? data.returns30d.reduce((s, r) => s + r, 0) / data.returns30d.length : null;
    const sorted7d = [...data.returns7d].sort((a, b) => a - b);
    const median7d = sorted7d.length > 0 ? sorted7d[Math.floor(sorted7d.length / 2)]! : null;
    const hitRate7d = data.returns7d.length > 0 ? data.returns7d.filter((r) => r > 0).length / data.returns7d.length : null;
    const hitRate30d = data.returns30d.length > 0 ? data.returns30d.filter((r) => r > 0).length / data.returns30d.length : null;
    rows.push({
      score_bucket: bucket!, asset_type: assetType!, sample_count: data.count,
      avg_forward_return_7d: avg7d, avg_forward_return_30d: avg30d,
      median_forward_return_7d: median7d, hit_rate_7d: hitRate7d, hit_rate_30d: hitRate30d,
      calibrated_expected_return: null,
    });
  }

  for (const row of rows) {
    const { error } = await supabase.from('score_calibration').upsert(row, { onConflict: 'score_bucket,asset_type' });
    if (error) console.error(`Calibration upsert error for ${row.score_bucket}/${row.asset_type}: ${error.message}`);
  }

  const calibratedCount = rows.filter((r) => r.calibrated_expected_return !== null).length;
  console.log(`[Calibrate] Persisted ${rows.length} calibration rows (${calibratedCount} with calibrated E[R], ${rows.length - calibratedCount} heuristic fallback)`);
}

// ===========================================================================
// Main
// ===========================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const supabase = getServiceSupabase();

  const runAll = args.includes('--all');
  const doScoreOutcomes = runAll || args.includes('--score-outcomes');
  const doOutcomes = runAll || args.includes('--outcomes');
  const doBacktest = runAll || args.includes('--backtest');
  const doCalibrate = runAll || args.includes('--calibrate');

  if (!doScoreOutcomes && !doOutcomes && !doBacktest && !doCalibrate) {
    console.log('Usage: npx tsx backend/jobs/evaluate-optimizer.ts [MODE...]');
    console.log('  --score-outcomes  Track forward returns for ALL scored assets (calibration source)');
    console.log('  --outcomes        Score live recommendation items against realized returns');
    console.log('  --backtest        Walk-forward simulation (use --from/--to for date range)');
    console.log('  --calibrate       Compute calibrated score→expected-return mapping');
    console.log('  --all             Run all four modes');
    return;
  }

  if (doScoreOutcomes) await generateScoreOutcomes(supabase);
  if (doOutcomes) await evaluateOutcomes(supabase);

  if (doBacktest) {
    const fromIdx = args.indexOf('--from');
    const toIdx = args.indexOf('--to');
    const fromDate = fromIdx >= 0 ? args[fromIdx + 1]! : '2026-01-01';
    const toDate = toIdx >= 0 ? args[toIdx + 1]! : new Date().toISOString().split('T')[0]!;
    await runBacktest(supabase, fromDate, toDate);
  }

  if (doCalibrate) await calibrate(supabase);
}

main().catch((err) => { console.error('[Evaluate] Fatal:', err); process.exit(1); });
