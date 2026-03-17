#!/usr/bin/env npx tsx
/**
 * Job: Optimizer-first daily portfolio management + LLM explanation.
 *
 * Flow:
 * 1. For each active portfolio, run the shared optimizer core to get target weights
 * 2. Generate deterministic actions from target-vs-current deltas
 * 3. Call LLM to explain the optimizer's actions (narrative only)
 * 4. Write recommendation_runs + recommendation_items from optimizer output
 * 5. Persist portfolio_risk_metrics
 *
 * Uses the same optimizer core as onboarding (shared/lib/optimizer-core.ts).
 *
 * Usage: npx tsx backend/jobs/synthesis.ts
 */
import { loadEnv } from './lib/env.js';
loadEnv();

import { getServiceSupabase } from './lib/supabase.js';
import { getConfig, getConfigNumber } from './lib/config.js';
import { extractJson } from './lib/json-parser.js';
import Anthropic from '@anthropic-ai/sdk';
import {
  ASSET_TYPE_MAP, SYNTHESIS_MODEL,
  DEFAULT_AGENT_WEIGHTS, getWeightsForTicker,
} from '../../shared/lib/constants.js';
import {
  runOptimizerCore,
  computeGoalProbabilityHeuristic,
  type OptimizerTickerScore,
  type OptimizerCurrentHolding,
  type OptimizerUserParams,
  type OptimizerPortfolioAction,
  type OptimizerOutput,
  type CalibrationMap,
  type CovarianceData,
} from '../../shared/lib/optimizer-core.js';
import type { AssetType } from '../../shared/types/assets.js';

type SB = ReturnType<typeof getServiceSupabase>;

// ---------------------------------------------------------------------------
// Calibration loader
// ---------------------------------------------------------------------------

import { CALIBRATION_LIVE_ENABLED } from '../../shared/lib/calibration-config.js';

async function loadCalibration(supabase: SB): Promise<CalibrationMap> {
  const cal = new Map<string, number>();

  // Global kill switch check
  if (!CALIBRATION_LIVE_ENABLED) {
    console.log('[Synthesis] Calibration globally disabled — using heuristic only');
    return cal;
  }

  const { data } = await supabase
    .from('score_calibration')
    .select('score_bucket, calibrated_expected_return, is_live_eligible')
    .is('asset_type', null)
    .not('calibrated_expected_return', 'is', null);
  for (const row of data ?? []) {
    // Only use rows marked as live-eligible by the calibration job
    if (row.is_live_eligible === true) {
      cal.set(row.score_bucket as string, Number(row.calibrated_expected_return));
    }
  }
  return cal;
}

// ---------------------------------------------------------------------------
// Score loading
// ---------------------------------------------------------------------------

async function findLatestScoreDate(supabase: SB, dateStr: string): Promise<string> {
  const MIN_FULL_RUN = 10;
  const { data: recentRows } = await supabase.from('agent_scores').select('date').eq('agent_type', 'technical').lte('date', dateStr).order('date', { ascending: false }).limit(500);
  if (!recentRows || recentRows.length === 0) return dateStr;
  const counts: Record<string, number> = {};
  for (const row of recentRows) { const d = row.date as string; counts[d] = (counts[d] || 0) + 1; }
  const sortedDates = Object.keys(counts).sort((a, b) => b.localeCompare(a));
  return sortedDates.find((d) => counts[d]! >= MIN_FULL_RUN) ?? sortedDates[0] ?? dateStr;
}

async function loadScores(supabase: SB, dateStr: string): Promise<OptimizerTickerScore[]> {
  const scoreDate = await findLatestScoreDate(supabase, dateStr);

  const { data: allScoreData } = await supabase
    .from('agent_scores')
    .select('ticker, score, agent_type, confidence, data_freshness')
    .eq('date', scoreDate)
    .limit(2000);

  const { data: regimeRows } = await supabase
    .from('agent_scores')
    .select('ticker, score, confidence')
    .in('ticker', ['MARKET', 'MARKET_CRYPTO'])
    .eq('agent_type', 'market_regime')
    .eq('date', scoreDate);

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
// Historical covariance data loader (vols + pairwise correlations)
// ---------------------------------------------------------------------------

async function loadCovarianceData(supabase: SB, tickers: string[]): Promise<CovarianceData> {
  const volatilities = new Map<string, number>();
  const correlations = new Map<string, number>();
  if (tickers.length === 0) return { volatilities, correlations };

  const { data } = await supabase
    .from('price_history')
    .select('ticker, close, date')
    .in('ticker', tickers)
    .order('date', { ascending: true })
    .limit(tickers.length * 120);

  if (!data || data.length === 0) return { volatilities, correlations };

  const byTicker = new Map<string, number[]>();
  const datesByTicker = new Map<string, string[]>();
  for (const row of data) {
    const t = row.ticker as string;
    if (!byTicker.has(t)) { byTicker.set(t, []); datesByTicker.set(t, []); }
    byTicker.get(t)!.push(Number(row.close));
    datesByTicker.get(t)!.push(row.date as string);
  }

  const returnsByTicker = new Map<string, Map<string, number>>();
  for (const [ticker, closes] of byTicker) {
    const dates = datesByTicker.get(ticker)!;
    if (closes.length < 20) continue;
    const returns: number[] = [];
    const returnMap = new Map<string, number>();
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1]! > 0) {
        const r = Math.log(closes[i]! / closes[i - 1]!);
        returns.push(r);
        returnMap.set(dates[i]!, r);
      }
    }
    if (returns.length < 15) continue;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    volatilities.set(ticker, Math.sqrt(variance * 252));
    returnsByTicker.set(ticker, returnMap);
  }

  // Pairwise correlations (for tickers in the portfolio, keep it bounded)
  const tickersWithReturns = [...returnsByTicker.keys()].slice(0, 30); // limit pairs for speed
  for (let i = 0; i < tickersWithReturns.length; i++) {
    const tA = tickersWithReturns[i]!;
    const rA = returnsByTicker.get(tA)!;
    for (let j = i + 1; j < tickersWithReturns.length; j++) {
      const tB = tickersWithReturns[j]!;
      const rB = returnsByTicker.get(tB)!;
      const pairsA: number[] = []; const pairsB: number[] = [];
      for (const [date, retA] of rA) {
        const retB = rB.get(date);
        if (retB !== undefined) { pairsA.push(retA); pairsB.push(retB); }
      }
      if (pairsA.length < 15) continue;
      const mA = pairsA.reduce((s, v) => s + v, 0) / pairsA.length;
      const mB = pairsB.reduce((s, v) => s + v, 0) / pairsB.length;
      let cov = 0, vA = 0, vB = 0;
      for (let k = 0; k < pairsA.length; k++) {
        const dA = pairsA[k]! - mA; const dB = pairsB[k]! - mB;
        cov += dA * dB; vA += dA * dA; vB += dB * dB;
      }
      const denom = Math.sqrt(vA * vB);
      if (denom > 0) {
        const key = tA < tB ? `${tA}|${tB}` : `${tB}|${tA}`;
        correlations.set(key, cov / denom);
      }
    }
  }

  return { volatilities, correlations };
}

// ---------------------------------------------------------------------------
// LLM Explanation (synthesis demoted to explanation-only)
// ---------------------------------------------------------------------------

function buildExplanationPrompt(
  actions: OptimizerPortfolioAction[],
  ctx: {
    totalValue: number; cashPct: number; goalProbPct: number; riskProfile: string;
    portfolioVol?: number; concentrationRisk?: number; avgCorrelation?: number;
    diversificationScore?: number; cryptoAllocationPct?: number;
  },
  macroEvents: string[],
): string {
  const lines: string[] = [];
  lines.push('You are an investment communication writer. The portfolio optimizer has determined the following target changes.');
  lines.push('Your job is to explain WHY these changes make sense in plain language, including how they affect portfolio risk. Do NOT suggest alternatives or override the optimizer.');
  lines.push('');
  lines.push(`Portfolio: $${ctx.totalValue.toLocaleString()} | Cash: ${ctx.cashPct.toFixed(1)}% | Risk profile: ${ctx.riskProfile}`);

  // Include risk context for richer explanations
  if (ctx.portfolioVol !== undefined) {
    lines.push(`Risk metrics: Vol ${(ctx.portfolioVol * 100).toFixed(1)}% | Diversification ${((ctx.diversificationScore ?? 0) * 100).toFixed(0)}% | Avg correlation ${((ctx.avgCorrelation ?? 0) * 100).toFixed(0)}%`);
    if ((ctx.cryptoAllocationPct ?? 0) > 0) {
      lines.push(`Crypto allocation: ${(ctx.cryptoAllocationPct ?? 0).toFixed(1)}%`);
    }
  }

  lines.push('');
  lines.push('OPTIMIZER ACTIONS:');
  for (const a of actions) {
    if (a.action === 'HOLD' && Math.abs(a.deltaWeightPct) < 1) continue;
    let line = `${a.action} ${a.ticker}: ${a.currentWeightPct.toFixed(1)}% -> ${a.targetWeightPct.toFixed(1)}% (delta ${a.deltaWeightPct > 0 ? '+' : ''}${a.deltaWeightPct.toFixed(1)}%)`;
    if (a.rationale) line += ` [${a.rationale}]`;
    lines.push(line);
  }
  if (macroEvents.length > 0) {
    lines.push('');
    lines.push('RECENT MACRO EVENTS:');
    for (const e of macroEvents) lines.push(`- ${e}`);
  }
  lines.push('');
  lines.push('When explaining actions, reference portfolio-level risk where relevant (concentration, diversification, volatility, correlation).');
  lines.push('Return ONLY valid JSON:');
  lines.push('{"portfolioNarrative": string (max 800 chars, plain language briefing), "actionExplanations": {"TICKER": "reason for this action", ...}, "goalStatus": "on_track"|"monitor"|"at_risk"|"off_track", "overallAssessment": string}');
  return lines.join('\n');
}

interface ExplanationOutput {
  portfolioNarrative: string;
  actionExplanations: Record<string, string>;
  goalStatus: 'on_track' | 'monitor' | 'at_risk' | 'off_track';
  overallAssessment: string;
}

async function generateExplanation(
  anthropic: Anthropic,
  actions: OptimizerPortfolioAction[],
  ctx: {
    totalValue: number; cashPct: number; goalProbPct: number; riskProfile: string;
    portfolioVol?: number; concentrationRisk?: number; avgCorrelation?: number;
    diversificationScore?: number; cryptoAllocationPct?: number;
  },
  macroEvents: string[],
  model: string,
  maxTokens: number,
): Promise<ExplanationOutput | null> {
  try {
    const prompt = buildExplanationPrompt(actions, ctx, macroEvents);
    const response = await anthropic.messages.create({
      model, max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    const rawText = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
    const parsed = extractJson(rawText) as ExplanationOutput;
    if (!parsed.portfolioNarrative) return null;
    return parsed;
  } catch (err) {
    console.warn('  [Synthesis] LLM explanation failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Run for single portfolio
// ---------------------------------------------------------------------------

async function runForPortfolio(
  supabase: SB, anthropic: Anthropic, portfolioId: string, userId: string, dateStr: string,
  allScores: OptimizerTickerScore[], calibration: CalibrationMap,
): Promise<string> {
  console.log(`  [Synthesis] Portfolio ${portfolioId} (user ${userId})`);

  // Load user profile
  const { data: profileData } = await supabase.from('user_profiles').select('*').eq('user_id', userId).single();
  if (!profileData) return 'error: no user profile';

  const userAssetTypes = (profileData.asset_types as AssetType[]) ?? ['stock', 'etf', 'crypto'];
  const rawDrawdown = Number(profileData.max_drawdown_limit_pct ?? 15);
  const maxDrawdownPct = rawDrawdown > 1 ? rawDrawdown / 100 : rawDrawdown;
  const riskProfile = (profileData.risk_profile as string) ?? 'balanced';
  const volatilityTolerance = (profileData.volatility_tolerance as string) ?? 'balanced';
  const maxPositions = Number(profileData.max_positions ?? 8);
  const goalReturnPct = Number(profileData.goal_return_pct ?? 0.07);
  const timeHorizonMonths = Number(profileData.time_horizon_months ?? 12);

  // Load positions
  const { data: positions } = await supabase.from('portfolio_positions').select('ticker, quantity, avg_purchase_price').eq('portfolio_id', portfolioId).eq('is_active', true);

  // Load prices
  const positionTickers = (positions ?? []).map((p) => p.ticker as string);
  const allTickers = [...new Set([...positionTickers, ...allScores.map((s) => s.ticker)])];
  const prices: Record<string, number> = {};

  const { data: priceData } = await supabase.from('price_history').select('ticker, close').in('ticker', allTickers.length > 0 ? allTickers : ['NONE']).order('date', { ascending: false }).limit(2000);
  for (const row of priceData ?? []) { const t = row.ticker as string; if (!prices[t]) prices[t] = Number(row.close); }

  const { data: quoteData } = await supabase.from('market_quotes').select('ticker, last_price').in('ticker', allTickers.length > 0 ? allTickers : ['NONE']).order('date', { ascending: false }).limit(2000);
  for (const row of quoteData ?? []) { const t = row.ticker as string; if (!prices[t]) prices[t] = Number(row.last_price); }

  // Portfolio value
  const { data: portfolioData } = await supabase.from('portfolios').select('cash_balance').eq('id', portfolioId).single();
  const cashBalance = portfolioData ? Number(portfolioData.cash_balance ?? 0) : 0;

  const currentHoldings: OptimizerCurrentHolding[] = [];
  let investedValue = 0;
  for (const pos of positions ?? []) {
    const ticker = pos.ticker as string;
    const qty = Number(pos.quantity);
    const avgPrice = Number(pos.avg_purchase_price);
    const currentPrice = prices[ticker] ?? avgPrice;
    const value = qty * currentPrice;
    investedValue += value;
    currentHoldings.push({ ticker, quantity: qty, avgPurchasePrice: avgPrice, currentPrice, currentValue: value, weightPct: 0 });
  }
  const totalValue = investedValue + cashBalance;
  for (const h of currentHoldings) { h.weightPct = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0; }

  // Apply drawdown hard stop — force-sell breached positions by setting score to -1
  const scoresCopy = allScores.map((s) => ({ ...s }));
  for (const h of currentHoldings) {
    const pnlPct = h.avgPurchasePrice > 0 ? (h.currentPrice - h.avgPurchasePrice) / h.avgPurchasePrice : 0;
    if (pnlPct < -maxDrawdownPct) {
      const s = scoresCopy.find((sc) => sc.ticker === h.ticker);
      if (s) s.compositeScore = -1;
    }
  }

  // Load covariance data (volatilities + pairwise correlations)
  const covData = await loadCovarianceData(supabase, allTickers.slice(0, 100));

  // Run shared optimizer core
  const userParams: OptimizerUserParams = {
    maxPositions,
    assetTypes: userAssetTypes,
    riskProfile: riskProfile as 'conservative' | 'balanced' | 'aggressive',
    volatilityTolerance: volatilityTolerance as 'moderate' | 'balanced' | 'tolerant',
    goalReturnPct,
    maxDrawdownLimitPct: maxDrawdownPct,
  };

  const optimizerResult = runOptimizerCore(scoresCopy, userParams, currentHoldings, covData, calibration);

  // Persist portfolio_risk_metrics (extended v2 fields)
  await supabase.from('portfolio_risk_metrics').upsert({
    portfolio_id: portfolioId,
    date: dateStr,
    volatility: optimizerResult.riskSummary.portfolioVolatility,
    max_drawdown_pct: Math.min(1, optimizerResult.riskSummary.maxDrawdownEstimate),
    diversification_score: optimizerResult.riskSummary.diversificationScore,
    concentration_risk: optimizerResult.riskSummary.concentrationRisk,
    avg_pairwise_correlation: optimizerResult.riskSummary.avgPairwiseCorrelation,
    crypto_allocation_pct: optimizerResult.riskSummary.cryptoAllocationPct,
    largest_position_pct: optimizerResult.riskSummary.largestPositionPct,
    tickers_with_vol_data: optimizerResult.riskSummary.tickersWithVolData,
    portfolio_expected_return: optimizerResult.riskSummary.expectedReturn,
  }, { onConflict: 'portfolio_id,date' }).then(({ error }) => {
    if (error) console.error(`    Risk metrics upsert error: ${error.message}`);
  });

  // LLM explanation
  const macroStart = new Date(dateStr); macroStart.setDate(macroStart.getDate() - 1);
  const { data: macroData } = await supabase.from('macro_events').select('event_description').gte('date', macroStart.toISOString().split('T')[0]!).lte('date', dateStr).order('date', { ascending: false }).limit(5);
  const macroEvents = (macroData ?? []).map((e) => e.event_description as string);

  const { data: valData } = await supabase.from('portfolio_valuations').select('goal_probability_pct').eq('portfolio_id', portfolioId).order('date', { ascending: false }).limit(1).single();
  const goalProbPct = valData ? Number(valData.goal_probability_pct ?? 50) : computeGoalProbabilityHeuristic({
    expectedReturn: optimizerResult.riskSummary.expectedReturn,
    goalReturnPct, timeHorizonMonths,
    positionCount: currentHoldings.length, maxPositions,
    portfolioVolatility: optimizerResult.riskSummary.portfolioVolatility,
    concentrationRisk: optimizerResult.riskSummary.concentrationRisk,
  });

  // Delete existing runs for today
  const { data: existingRuns } = await supabase.from('synthesis_runs').select('id').eq('portfolio_id', portfolioId).eq('run_date', dateStr);
  if (existingRuns && existingRuns.length > 0) {
    const runIds = existingRuns.map((r) => r.id as string);
    const { data: oldRecRuns } = await supabase.from('recommendation_runs').select('id').in('synthesis_run_id', runIds);
    if (oldRecRuns && oldRecRuns.length > 0) {
      const recRunIds = oldRecRuns.map((r) => r.id as string);
      await supabase.from('recommendation_items').delete().in('run_id', recRunIds);
      await supabase.from('recommendation_runs').delete().in('id', recRunIds);
    }
    await supabase.from('synthesis_raw_outputs').delete().in('synthesis_run_id', runIds);
    await supabase.from('synthesis_runs').delete().in('id', runIds);
  }

  const [synthesisModel, maxTokensSynthesis] = await Promise.all([
    getConfig('model_synthesis', SYNTHESIS_MODEL),
    getConfigNumber('max_tokens_synthesis', 4096),
  ]);

  const explanation = await generateExplanation(
    anthropic, optimizerResult.actions,
    {
      totalValue, cashPct: optimizerResult.cashWeightPct, goalProbPct, riskProfile,
      portfolioVol: optimizerResult.riskSummary.portfolioVolatility,
      concentrationRisk: optimizerResult.riskSummary.concentrationRisk,
      avgCorrelation: optimizerResult.riskSummary.avgPairwiseCorrelation,
      diversificationScore: optimizerResult.riskSummary.diversificationScore,
      cryptoAllocationPct: optimizerResult.riskSummary.cryptoAllocationPct,
    },
    macroEvents, synthesisModel, maxTokensSynthesis,
  );

  const llmSucceeded = !!explanation;

  // Create synthesis run record
  const { data: runRecord, error: runError } = await supabase.from('synthesis_runs').insert({
    user_id: userId, portfolio_id: portfolioId, run_date: dateStr,
    model_used: llmSucceeded ? synthesisModel : 'optimizer-only',
    input_tokens: 0, output_tokens: 0, latency_ms: 0,
    llm_call_succeeded: llmSucceeded, fallback_used: !llmSucceeded,
  }).select('id').single();
  if (runError || !runRecord) return `error: failed to create synthesis run: ${runError?.message ?? 'unknown'}`;
  const runId = runRecord.id as string;

  await supabase.from('synthesis_raw_outputs').insert({
    synthesis_run_id: runId,
    raw_llm_output: explanation ?? { optimizerOnly: true },
    post_rules_output: { targetWeights: optimizerResult.targetWeights, actions: optimizerResult.actions, riskSummary: optimizerResult.riskSummary },
    overrides_applied: [],
    low_confidence_reasons: llmSucceeded ? [] : ['LLM explanation unavailable — recommendations from optimizer only'],
  });

  const narrative = explanation?.portfolioNarrative
    ?? `Optimizer-generated recommendations based on quantitative scores. ${optimizerResult.actions.filter((a) => a.action !== 'HOLD').length} position changes suggested.`;
  const goalStatus = explanation?.goalStatus ?? 'monitor';

  const { data: recRun, error: recRunError } = await supabase.from('recommendation_runs').insert({
    portfolio_id: portfolioId, run_date: dateStr, synthesis_run_id: runId,
    overall_confidence: optimizerResult.actions.reduce((s, a) => s + a.confidence, 0) / Math.max(1, optimizerResult.actions.length),
    goal_status: goalStatus,
    portfolio_narrative: narrative.slice(0, 1000),
    weight_rationale: { technical: DEFAULT_AGENT_WEIGHTS.technical, sentiment: DEFAULT_AGENT_WEIGHTS.sentiment, fundamental: DEFAULT_AGENT_WEIGHTS.fundamental, regime: DEFAULT_AGENT_WEIGHTS.regime, reasoning: 'Optimizer-determined target weights' },
    fallback_used: !llmSucceeded,
  }).select('id').single();
  if (recRunError || !recRun) return `error: ${recRunError?.message}`;
  const recRunId = recRun.id as string;

  const { data: validAssets } = await supabase.from('assets').select('ticker');
  const validTickers = new Set((validAssets ?? []).map((a) => a.ticker as string));
  const validActions = optimizerResult.actions.filter((a) => validTickers.has(a.ticker));
  const itemErrors: string[] = [];

  for (let i = 0; i < validActions.length; i++) {
    const a = validActions[i]!;
    const explanationText = explanation?.actionExplanations?.[a.ticker]
      ?? `Optimizer: ${a.action} ${a.ticker} from ${a.currentWeightPct.toFixed(1)}% to ${a.targetWeightPct.toFixed(1)}%`;

    const { error: itemError } = await supabase.from('recommendation_items').insert({
      run_id: recRunId, ticker: a.ticker, action: a.action, urgency: a.urgency,
      current_allocation_pct: a.currentWeightPct, target_allocation_pct: a.targetWeightPct,
      llm_reasoning: explanationText, confidence: a.confidence,
      rules_engine_applied: false, rules_engine_note: null, priority: i + 1,
    });
    if (itemError) {
      console.error(`    Failed to insert recommendation for ${a.ticker}: ${itemError.message}`);
      itemErrors.push(`${a.ticker}: ${itemError.message}`);
    }
  }

  if (itemErrors.length > 0) {
    console.error(`    ${itemErrors.length}/${validActions.length} items failed — cleaning up`);
    await supabase.from('recommendation_items').delete().eq('run_id', recRunId);
    await supabase.from('recommendation_runs').delete().eq('id', recRunId);
    return `error: item inserts failed (${itemErrors.join('; ')})`;
  }

  const llmNote = llmSucceeded ? 'llm=true' : 'llm=false (optimizer-only)';
  console.log(`    Done: ${validActions.length} recs, ${llmNote}, vol=${optimizerResult.riskSummary.portfolioVolatility.toFixed(3)}`);
  return `ok (${validActions.length} recs, ${llmNote})`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

  const supabase = getServiceSupabase();
  const anthropic = new Anthropic({ apiKey });
  const dateStr = new Date().toISOString().split('T')[0]!;

  console.log(`[Synthesis] Starting optimizer-first synthesis for ${dateStr}`);

  const allScores = await loadScores(supabase, dateStr);
  const calibration = await loadCalibration(supabase);
  console.log(`[Synthesis] Loaded ${allScores.length} ticker scores, ${calibration.size} calibration entries`);

  const { data: portfolios, error } = await supabase.from('portfolios').select('id, user_id').eq('status', 'active');
  if (error) { console.error('Failed to load portfolios:', error.message); process.exit(1); }
  if (!portfolios || portfolios.length === 0) { console.log('[Synthesis] No active portfolios'); return; }

  console.log(`[Synthesis] Processing ${portfolios.length} portfolio(s)`);

  let success = 0, errors = 0;
  for (const portfolio of portfolios) {
    try {
      const result = await runForPortfolio(supabase, anthropic, portfolio.id as string, portfolio.user_id as string, dateStr, allScores, calibration);
      if (result.startsWith('ok')) success++; else errors++;
    } catch (err) {
      console.error(`  Error for ${portfolio.id}:`, err instanceof Error ? err.message : err);
      errors++;
    }
  }

  console.log(`[Synthesis] Done: ${success} success, ${errors} errors`);
  if (errors > 0 && success === 0) process.exit(1);
}

main().catch((err) => { console.error('[Synthesis] Fatal:', err); process.exit(1); });
