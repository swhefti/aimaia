#!/usr/bin/env npx tsx
/**
 * Job: Evaluate optimizer performance using historical data.
 *
 * Three modes:
 *   1. --outcomes   Score recent recommendations against realized forward returns
 *   2. --backtest   Walk-forward simulation over a date range
 *   3. --calibrate  Compute calibrated score→expected-return mapping from outcomes
 *
 * Usage:
 *   npx tsx backend/jobs/evaluate-optimizer.ts --outcomes
 *   npx tsx backend/jobs/evaluate-optimizer.ts --backtest --from 2026-01-01 --to 2026-03-15
 *   npx tsx backend/jobs/evaluate-optimizer.ts --calibrate
 *   npx tsx backend/jobs/evaluate-optimizer.ts --all   (run all three)
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
  // Find closest price on or after target (markets may be closed)
  const end = new Date(target);
  end.setDate(end.getDate() + 4); // allow up to 4 extra days for weekends
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

// ---------------------------------------------------------------------------
// Mode 1: Score recent recommendations against realized returns
// ---------------------------------------------------------------------------

async function evaluateOutcomes(supabase: SB): Promise<void> {
  console.log('[Evaluate] Scoring recommendation outcomes...');

  // Find recommendation items that haven't been evaluated yet
  const { data: items } = await supabase
    .from('recommendation_items')
    .select('id, ticker, action, confidence, current_allocation_pct, target_allocation_pct, run_id')
    .order('created_at', { ascending: false })
    .limit(500);

  if (!items || items.length === 0) {
    console.log('[Evaluate] No recommendation items found.');
    return;
  }

  // Get run dates for each item
  const runIds = [...new Set(items.map((i) => i.run_id as string))];
  const { data: runs } = await supabase
    .from('recommendation_runs')
    .select('id, run_date')
    .in('id', runIds);

  const runDateMap = new Map<string, string>();
  for (const r of runs ?? []) runDateMap.set(r.id as string, r.run_date as string);

  // Check which items already have outcomes
  const { data: existingOutcomes } = await supabase
    .from('recommendation_outcomes')
    .select('recommendation_id')
    .in('recommendation_id', items.map((i) => i.id as string));

  const evaluated = new Set((existingOutcomes ?? []).map((o) => o.recommendation_id as string));

  // Get scores for context
  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    if (evaluated.has(item.id as string)) { skipped++; continue; }

    const runDate = runDateMap.get(item.run_id as string);
    if (!runDate) continue;

    const ticker = item.ticker as string;
    const action = item.action as string;

    // Get price at decision time
    const priceAtDecision = await getPrice(supabase, ticker, runDate);
    if (!priceAtDecision) continue;

    // Get forward prices
    const price1d = await getPriceAfterDays(supabase, ticker, runDate, 1);
    const price7d = await getPriceAfterDays(supabase, ticker, runDate, 7);
    const price30d = await getPriceAfterDays(supabase, ticker, runDate, 30);

    // Benchmark (SPY)
    const spyAtDecision = await getPrice(supabase, 'SPY', runDate);
    const spy1d = await getPriceAfterDays(supabase, 'SPY', runDate, 1);
    const spy7d = await getPriceAfterDays(supabase, 'SPY', runDate, 7);
    const spy30d = await getPriceAfterDays(supabase, 'SPY', runDate, 30);

    const return1d = price1d && priceAtDecision ? (price1d - priceAtDecision) / priceAtDecision : null;
    const return7d = price7d && priceAtDecision ? (price7d - priceAtDecision) / priceAtDecision : null;
    const return30d = price30d && priceAtDecision ? (price30d - priceAtDecision) / priceAtDecision : null;

    const benchReturn1d = spy1d && spyAtDecision ? (spy1d - spyAtDecision) / spyAtDecision : null;
    const benchReturn7d = spy7d && spyAtDecision ? (spy7d - spyAtDecision) / spyAtDecision : null;
    const benchReturn30d = spy30d && spyAtDecision ? (spy30d - spyAtDecision) / spyAtDecision : null;

    // Get composite score for this ticker on this date
    const { data: scoreData } = await supabase
      .from('agent_scores')
      .select('score, confidence, data_freshness')
      .eq('ticker', ticker)
      .eq('date', runDate)
      .eq('agent_type', 'technical')
      .limit(1)
      .single();

    const compositeScore = scoreData ? Number(scoreData.score) : null;
    const confidence = Number(item.confidence ?? 0);
    const freshness = (scoreData?.data_freshness as string) ?? 'missing';

    const assetType = ASSET_TYPE_MAP[ticker] ?? 'stock';

    const { error } = await supabase.from('recommendation_outcomes').insert({
      recommendation_id: item.id,
      ticker,
      run_date: runDate,
      asset_type: assetType,
      action,
      composite_score: compositeScore,
      confidence,
      data_freshness: freshness,
      current_weight_pct: item.current_allocation_pct,
      target_weight_pct: item.target_allocation_pct,
      expected_return: compositeScore !== null ? compositeScore * 0.30 : null,
      price_at_decision: priceAtDecision,
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
      score_bucket: compositeScore !== null ? scoreBucket(compositeScore) : null,
      confidence_bucket: confidenceBucket(confidence),
    });

    if (error) console.error(`  Outcome insert error for ${ticker}: ${error.message}`);
    else inserted++;
  }

  console.log(`[Evaluate] Outcomes: ${inserted} scored, ${skipped} already evaluated, ${items.length} total items checked`);
}

// ---------------------------------------------------------------------------
// Mode 2: Walk-forward backtest
// ---------------------------------------------------------------------------

async function runBacktest(supabase: SB, fromDate: string, toDate: string): Promise<void> {
  console.log(`[Backtest] Walk-forward from ${fromDate} to ${toDate}`);

  const userParams: OptimizerUserParams = {
    maxPositions: 8,
    assetTypes: ['stock', 'etf', 'crypto'] as AssetType[],
    riskProfile: 'balanced',
    volatilityTolerance: 'balanced',
    goalReturnPct: 0.07,
    maxDrawdownLimitPct: 0.15,
  };

  // Find all scoring dates in range
  const { data: scoreDates } = await supabase
    .from('agent_scores')
    .select('date')
    .eq('agent_type', 'technical')
    .gte('date', fromDate)
    .lte('date', toDate)
    .order('date', { ascending: true })
    .limit(5000);

  const uniqueDates = [...new Set((scoreDates ?? []).map((r) => r.date as string))].sort();

  // Filter to dates with at least 10 scores (full pipeline runs)
  const validDates: string[] = [];
  const dateCounts = new Map<string, number>();
  for (const row of scoreDates ?? []) {
    const d = row.date as string;
    dateCounts.set(d, (dateCounts.get(d) ?? 0) + 1);
  }
  for (const d of uniqueDates) {
    if ((dateCounts.get(d) ?? 0) >= 10) validDates.push(d);
  }

  if (validDates.length < 2) {
    console.log('[Backtest] Not enough scoring dates for walk-forward. Need at least 2.');
    return;
  }

  console.log(`[Backtest] ${validDates.length} valid scoring dates`);

  // Walk-forward simulation
  let portfolioValue = 100000;
  const initialValue = portfolioValue;
  let cash = portfolioValue;
  let holdings = new Map<string, { quantity: number; price: number; weightPct: number }>();
  let peakValue = portfolioValue;
  let maxDrawdown = 0;
  let totalTurnover = 0;
  const dailyReturns: number[] = [];
  let totalRecs = 0;
  let hits7d = 0;
  let total7d = 0;
  let hits30d = 0;
  let total30d = 0;
  let buyReturns7d: number[] = [];
  let sellReturns7d: number[] = [];

  // Get SPY prices for benchmark
  const spyStart = await getPrice(supabase, 'SPY', validDates[0]!);
  const spyEnd = await getPrice(supabase, 'SPY', validDates[validDates.length - 1]!);

  for (let di = 0; di < validDates.length; di++) {
    const date = validDates[di]!;
    const scores = await loadScoresForDate(supabase, date);
    if (scores.length === 0) continue;

    // Get current prices for all tickers
    const prices = new Map<string, number>();
    for (const s of scores) {
      const p = await getPrice(supabase, s.ticker, date);
      if (p) prices.set(s.ticker, p);
    }

    // Update portfolio value
    let investedValue = 0;
    for (const [ticker, h] of holdings) {
      const currentPrice = prices.get(ticker) ?? h.price;
      investedValue += h.quantity * currentPrice;
      h.price = currentPrice;
    }
    const prevValue = portfolioValue;
    portfolioValue = investedValue + cash;

    if (di > 0) {
      const dailyReturn = prevValue > 0 ? (portfolioValue - prevValue) / prevValue : 0;
      dailyReturns.push(dailyReturn);
    }

    if (portfolioValue > peakValue) peakValue = portfolioValue;
    const dd = peakValue > 0 ? (peakValue - portfolioValue) / peakValue : 0;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Build current holdings for optimizer
    const currentHoldings = [...holdings.entries()].map(([ticker, h]) => ({
      ticker,
      quantity: h.quantity,
      avgPurchasePrice: h.price,
      currentPrice: h.price,
      currentValue: h.quantity * h.price,
      weightPct: portfolioValue > 0 ? (h.quantity * h.price / portfolioValue) * 100 : 0,
    }));

    // Run optimizer
    const result = runOptimizerCore(scores, userParams, currentHoldings, new Map());

    // Execute actions (simplified)
    for (const action of result.actions) {
      if (action.action === 'HOLD') continue;
      const price = prices.get(action.ticker);
      if (!price) continue;

      totalRecs++;

      // Track forward returns for quality metrics
      const price7d = await getPriceAfterDays(supabase, action.ticker, date, 7);
      const price30d = await getPriceAfterDays(supabase, action.ticker, date, 30);
      if (price7d) {
        const ret7d = (price7d - price) / price;
        total7d++;
        if (action.action === 'BUY' || action.action === 'ADD') {
          buyReturns7d.push(ret7d);
          if (ret7d > 0) hits7d++;
        } else if (action.action === 'SELL' || action.action === 'REDUCE') {
          sellReturns7d.push(ret7d);
          if (ret7d < 0) hits7d++; // SELL is "right" if price went down
        }
      }
      if (price30d) {
        const ret30d = (price30d - price) / price;
        total30d++;
        if (action.action === 'BUY' || action.action === 'ADD') {
          if (ret30d > 0) hits30d++;
        } else if (action.action === 'SELL' || action.action === 'REDUCE') {
          if (ret30d < 0) hits30d++;
        }
      }

      // Execute trade
      const targetValue = portfolioValue * (action.targetWeightPct / 100);
      const currentHolding = holdings.get(action.ticker);
      const currentValue = currentHolding ? currentHolding.quantity * price : 0;
      const tradeValue = targetValue - currentValue;
      totalTurnover += Math.abs(tradeValue) / portfolioValue;

      if (action.action === 'SELL') {
        if (currentHolding) {
          cash += currentHolding.quantity * price;
          holdings.delete(action.ticker);
        }
      } else if (action.action === 'BUY' || action.action === 'ADD') {
        if (tradeValue > 0 && cash >= tradeValue) {
          const qty = tradeValue / price;
          const existing = holdings.get(action.ticker);
          if (existing) {
            existing.quantity += qty;
          } else {
            holdings.set(action.ticker, { quantity: qty, price, weightPct: action.targetWeightPct });
          }
          cash -= tradeValue;
        }
      } else if (action.action === 'REDUCE') {
        if (currentHolding && tradeValue < 0) {
          const reduceQty = Math.abs(tradeValue) / price;
          currentHolding.quantity = Math.max(0, currentHolding.quantity - reduceQty);
          cash += Math.abs(tradeValue);
          if (currentHolding.quantity < 0.001) holdings.delete(action.ticker);
        }
      }
    }
  }

  // Final metrics
  const cumReturn = initialValue > 0 ? (portfolioValue - initialValue) / initialValue : 0;
  const tradingDays = dailyReturns.length;
  const annualizedReturn = tradingDays > 0 ? Math.pow(1 + cumReturn, 252 / tradingDays) - 1 : 0;
  const meanDailyReturn = dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
  const dailyVol = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - meanDailyReturn) ** 2, 0) / (dailyReturns.length - 1))
    : 0;
  const realizedVol = dailyVol * Math.sqrt(252);
  const sharpe = realizedVol > 0 ? annualizedReturn / realizedVol : 0;
  const benchReturn = spyStart && spyEnd ? (spyEnd - spyStart) / spyStart : 0;
  const excessReturn = cumReturn - benchReturn;
  const hitRate7d = total7d > 0 ? hits7d / total7d : 0;
  const hitRate30d = total30d > 0 ? hits30d / total30d : 0;
  const avgBuyReturn7d = buyReturns7d.length > 0 ? buyReturns7d.reduce((s, r) => s + r, 0) / buyReturns7d.length : 0;
  const avgSellReturn7d = sellReturns7d.length > 0 ? sellReturns7d.reduce((s, r) => s + r, 0) / sellReturns7d.length : 0;

  const report = {
    period: { from: fromDate, to: toDate, tradingDays },
    portfolio: {
      cumulativeReturn: cumReturn,
      annualizedReturn,
      maxDrawdown,
      realizedVolatility: realizedVol,
      sharpeRatio: sharpe,
      totalTurnover,
      finalValue: portfolioValue,
    },
    benchmark: { spyReturn: benchReturn, excessReturn },
    recommendations: {
      total: totalRecs,
      hitRate7d,
      hitRate30d,
      avgBuyReturn7d,
      avgSellReturn7d,
    },
  };

  // Persist backtest run
  const { error } = await supabase.from('optimizer_backtest_runs').insert({
    start_date: fromDate,
    end_date: toDate,
    risk_profile: userParams.riskProfile,
    asset_types: userParams.assetTypes,
    max_positions: userParams.maxPositions,
    cumulative_return_pct: cumReturn,
    annualized_return_pct: annualizedReturn,
    max_drawdown_pct: maxDrawdown,
    realized_volatility: realizedVol,
    sharpe_ratio: sharpe,
    total_turnover: totalTurnover,
    benchmark_return_pct: benchReturn,
    excess_return_pct: excessReturn,
    total_recommendations: totalRecs,
    hit_rate_7d: hitRate7d,
    hit_rate_30d: hitRate30d,
    avg_return_buy_7d: avgBuyReturn7d,
    avg_return_sell_7d: avgSellReturn7d,
    config_snapshot: { riskProfile: userParams.riskProfile, maxPositions: userParams.maxPositions },
    report_json: report,
  });

  if (error) console.error('[Backtest] Failed to persist run:', error.message);

  // Print summary
  console.log('\n========== BACKTEST RESULTS ==========');
  console.log(`Period: ${fromDate} to ${toDate} (${tradingDays} trading days)`);
  console.log(`\nPortfolio Performance:`);
  console.log(`  Cumulative Return:  ${pct(cumReturn)}`);
  console.log(`  Annualized Return:  ${pct(annualizedReturn)}`);
  console.log(`  Max Drawdown:       ${pct(maxDrawdown)}`);
  console.log(`  Realized Volatility:${pct(realizedVol)}`);
  console.log(`  Sharpe Ratio:       ${sharpe.toFixed(2)}`);
  console.log(`  Total Turnover:     ${totalTurnover.toFixed(2)}x`);
  console.log(`\nBenchmark (SPY):`);
  console.log(`  SPY Return:         ${pct(benchReturn)}`);
  console.log(`  Excess Return:      ${pct(excessReturn)}`);
  console.log(`\nRecommendation Quality:`);
  console.log(`  Total Recs:         ${totalRecs}`);
  console.log(`  Hit Rate (7d):      ${pct(hitRate7d)}`);
  console.log(`  Hit Rate (30d):     ${pct(hitRate30d)}`);
  console.log(`  Avg BUY Return 7d:  ${pct(avgBuyReturn7d)}`);
  console.log(`  Avg SELL Return 7d: ${pct(avgSellReturn7d)}`);
  console.log('======================================\n');
}

// ---------------------------------------------------------------------------
// Mode 3: Calibrate score→expected-return mapping
// ---------------------------------------------------------------------------

async function calibrate(supabase: SB): Promise<void> {
  console.log('[Calibrate] Computing calibrated expected-return mapping from outcomes...');

  // Load all outcomes that have 7d or 30d returns
  const { data: outcomes } = await supabase
    .from('recommendation_outcomes')
    .select('composite_score, confidence, asset_type, return_7d, return_30d, action, score_bucket')
    .not('return_7d', 'is', null)
    .limit(5000);

  if (!outcomes || outcomes.length === 0) {
    console.log('[Calibrate] No outcomes with forward returns found. Run --outcomes first.');
    return;
  }

  console.log(`[Calibrate] Analyzing ${outcomes.length} outcomes`);

  // Bucket analysis
  const buckets = new Map<string, { returns7d: number[]; returns30d: number[]; count: number }>();
  const assetBuckets = new Map<string, { returns7d: number[]; returns30d: number[]; count: number }>();

  for (const o of outcomes) {
    const bucket = o.score_bucket as string ?? 'unknown';
    const assetType = o.asset_type as string ?? 'unknown';
    const key = bucket;
    const assetKey = `${bucket}|${assetType}`;

    if (!buckets.has(key)) buckets.set(key, { returns7d: [], returns30d: [], count: 0 });
    if (!assetBuckets.has(assetKey)) assetBuckets.set(assetKey, { returns7d: [], returns30d: [], count: 0 });

    const entry = buckets.get(key)!;
    const assetEntry = assetBuckets.get(assetKey)!;
    entry.count++;
    assetEntry.count++;

    if (o.return_7d != null) {
      entry.returns7d.push(Number(o.return_7d));
      assetEntry.returns7d.push(Number(o.return_7d));
    }
    if (o.return_30d != null) {
      entry.returns30d.push(Number(o.return_30d));
      assetEntry.returns30d.push(Number(o.return_30d));
    }
  }

  // Compute calibrated values and persist
  const rows: Array<{
    score_bucket: string; asset_type: string | null; sample_count: number;
    avg_forward_return_7d: number | null; avg_forward_return_30d: number | null;
    median_forward_return_7d: number | null; hit_rate_7d: number | null;
    hit_rate_30d: number | null; calibrated_expected_return: number | null;
  }> = [];

  console.log('\n========== CALIBRATION RESULTS ==========');
  console.log('Score Bucket     | N    | Avg 7d    | Avg 30d   | Hit 7d | Cal. E[R]');
  console.log('-----------------|------|-----------|-----------|--------|----------');

  for (const [bucket, data] of buckets) {
    const avg7d = data.returns7d.length > 0 ? data.returns7d.reduce((s, r) => s + r, 0) / data.returns7d.length : null;
    const avg30d = data.returns30d.length > 0 ? data.returns30d.reduce((s, r) => s + r, 0) / data.returns30d.length : null;
    const sorted7d = [...data.returns7d].sort((a, b) => a - b);
    const median7d = sorted7d.length > 0 ? sorted7d[Math.floor(sorted7d.length / 2)]! : null;
    const hitRate7d = data.returns7d.length > 0 ? data.returns7d.filter((r) => r > 0).length / data.returns7d.length : null;
    const hitRate30d = data.returns30d.length > 0 ? data.returns30d.filter((r) => r > 0).length / data.returns30d.length : null;

    // Calibrated expected return: annualize the 30d return if available, else 7d
    // Use a weighted blend: 70% observed 30d annualized + 30% original heuristic
    const observed30dAnnualized = avg30d !== null ? avg30d * (252 / 30) : null;
    const observed7dAnnualized = avg7d !== null ? avg7d * (252 / 7) : null;
    const observedAnnualized = observed30dAnnualized ?? observed7dAnnualized ?? null;

    // Original heuristic expected return for this bucket's midpoint
    const bucketMidScores: Record<string, number> = {
      strong_buy: 0.80, buy: 0.40, hold: 0, sell: -0.40, strong_sell: -0.80,
    };
    const heuristicER = (bucketMidScores[bucket] ?? 0) * 0.30;
    const calibratedER = observedAnnualized !== null && data.count >= 5
      ? observedAnnualized * 0.7 + heuristicER * 0.3
      : heuristicER;

    rows.push({
      score_bucket: bucket, asset_type: null, sample_count: data.count,
      avg_forward_return_7d: avg7d, avg_forward_return_30d: avg30d,
      median_forward_return_7d: median7d, hit_rate_7d: hitRate7d,
      hit_rate_30d: hitRate30d, calibrated_expected_return: calibratedER,
    });

    console.log(
      `${bucket.padEnd(17)}| ${String(data.count).padEnd(5)}| ${avg7d !== null ? pct(avg7d).padEnd(10) : 'N/A       '}| ${avg30d !== null ? pct(avg30d).padEnd(10) : 'N/A       '}| ${hitRate7d !== null ? pct(hitRate7d).padEnd(7) : 'N/A    '}| ${pct(calibratedER)}`
    );
  }
  console.log('=========================================\n');

  // Also compute per-asset-type buckets
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
      median_forward_return_7d: median7d, hit_rate_7d: hitRate7d,
      hit_rate_30d: hitRate30d, calibrated_expected_return: null,
    });
  }

  // Upsert calibration data
  for (const row of rows) {
    const { error } = await supabase.from('score_calibration').upsert(row, {
      onConflict: 'score_bucket,asset_type',
    });
    if (error) console.error(`Calibration upsert error for ${row.score_bucket}/${row.asset_type}: ${error.message}`);
  }

  console.log(`[Calibrate] Persisted ${rows.length} calibration rows`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const supabase = getServiceSupabase();

  const runAll = args.includes('--all');
  const doOutcomes = runAll || args.includes('--outcomes');
  const doBacktest = runAll || args.includes('--backtest');
  const doCalibrate = runAll || args.includes('--calibrate');

  if (!doOutcomes && !doBacktest && !doCalibrate) {
    console.log('Usage: npx tsx backend/jobs/evaluate-optimizer.ts [--outcomes] [--backtest] [--calibrate] [--all]');
    console.log('  --outcomes   Score recent recommendations against realized returns');
    console.log('  --backtest   Walk-forward simulation (use --from/--to for date range)');
    console.log('  --calibrate  Compute calibrated score→expected-return mapping');
    console.log('  --all        Run all three');
    return;
  }

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
