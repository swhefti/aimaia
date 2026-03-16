#!/usr/bin/env npx tsx
/**
 * Job: Optimizer-first daily portfolio management + LLM explanation.
 *
 * Flow:
 * 1. For each active portfolio, run the optimizer to get target weights
 * 2. Generate deterministic actions from target-vs-current deltas
 * 3. Call LLM to explain the optimizer's actions (narrative only)
 * 4. Write recommendation_runs + recommendation_items from optimizer output
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
  ASSET_UNIVERSE, ASSET_TYPE_MAP, SYNTHESIS_MODEL,
  MAX_POSITION_PCT, MAX_CRYPTO_ALLOCATION_PCT, CASH_FLOOR_PCT,
  MAX_DAILY_CHANGES, DEFAULT_AGENT_WEIGHTS, getWeightsForTicker,
} from '../../shared/lib/constants.js';
import type { AssetType } from '../../shared/types/assets.js';

// Inline optimizer types (avoid cross-project import issues)
interface TickerScore {
  ticker: string;
  compositeScore: number;
  confidence: number;
  dataFreshness: 'current' | 'stale' | 'missing';
  technicalScore: number;
  sentimentScore: number;
  fundamentalScore: number;
  regimeScore: number;
}

interface CurrentHolding {
  ticker: string;
  quantity: number;
  avgPurchasePrice: number;
  currentPrice: number;
  currentValue: number;
  weightPct: number;
}

type OptimizerAction = 'BUY' | 'ADD' | 'REDUCE' | 'SELL' | 'HOLD';

interface PortfolioAction {
  ticker: string;
  action: OptimizerAction;
  currentWeightPct: number;
  targetWeightPct: number;
  deltaWeightPct: number;
  confidence: number;
  urgency: 'high' | 'medium' | 'low';
}

interface TargetWeight {
  ticker: string;
  weightPct: number;
}

type SB = ReturnType<typeof getServiceSupabase>;
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }

// ---------------------------------------------------------------------------
// Optimizer (inline, same logic as backend/optimizer/)
// ---------------------------------------------------------------------------

const BASE_RETURN_SCALE = 0.30;
const NEAR_ZERO_THRESHOLD = 0.5;

function computeExpectedReturn(s: TickerScore): number {
  let mu = s.compositeScore * BASE_RETURN_SCALE;
  const confMult = s.confidence < 0.3 ? s.confidence / 0.3 * 0.5 : 0.5 + (s.confidence - 0.3) / 0.7 * 0.5;
  mu *= confMult;
  if (s.dataFreshness === 'stale') mu *= 0.7;
  if (s.dataFreshness === 'missing') mu *= 0.3;
  return mu;
}

function optimizePortfolio(
  scores: TickerScore[],
  currentHoldings: CurrentHolding[],
  totalValue: number,
  cashBalance: number,
  userParams: { maxPositions: number; assetTypes: AssetType[]; riskProfile: string; volatilityTolerance: string },
): { targetWeights: TargetWeight[]; cashWeightPct: number; actions: PortfolioAction[] } {
  const currentTickers = new Set(currentHoldings.map((h) => h.ticker));

  // Filter eligible tickers
  const eligible = scores.filter((s) => {
    const type = ASSET_TYPE_MAP[s.ticker] as AssetType | undefined;
    return type && userParams.assetTypes.includes(type);
  });

  // Always include current holdings + top new candidates
  const current = eligible.filter((s) => currentTickers.has(s.ticker));
  const candidates = eligible.filter((s) => !currentTickers.has(s.ticker)).sort((a, b) => b.compositeScore - a.compositeScore);
  const maxNew = Math.max(0, userParams.maxPositions * 3 - current.length);
  const allCandidates = [...current, ...candidates.slice(0, maxNew)];

  // Compute expected returns and select top N
  const withReturns = allCandidates.map((s) => ({ ...s, expectedReturn: computeExpectedReturn(s) }));
  withReturns.sort((a, b) => b.expectedReturn - a.expectedReturn);

  const selected = withReturns.slice(0, userParams.maxPositions);
  if (selected.length === 0) {
    return { targetWeights: [], cashWeightPct: 100, actions: [] };
  }

  // Score-proportional allocation
  const investablePct = 100 * (1 - CASH_FLOOR_PCT);
  const maxSinglePct = MAX_POSITION_PCT * 100;

  let riskPenalty = 2.0;
  if (userParams.riskProfile === 'conservative') riskPenalty = 4.0;
  else if (userParams.riskProfile === 'aggressive') riskPenalty = 1.0;

  const minMu = Math.min(...selected.map((s) => s.expectedReturn));
  const shift = minMu < 0.001 ? Math.abs(minMu) + 0.001 : 0;
  const shifted = selected.map((s) => s.expectedReturn + shift);
  const totalShifted = shifted.reduce((sum, v) => sum + v, 0);
  const equalPct = investablePct / selected.length;

  const scoreBlend = userParams.riskProfile === 'aggressive' ? 0.7 : userParams.riskProfile === 'conservative' ? 0.3 : 0.5;

  // Include turnover penalty: bias toward current weights
  const currentWeightMap = new Map<string, number>();
  for (const h of currentHoldings) currentWeightMap.set(h.ticker, h.weightPct);

  let weights = selected.map((s, i) => {
    const scorePct = totalShifted > 0 ? (shifted[i]! / totalShifted) * investablePct : equalPct;
    let blended = scorePct * scoreBlend + equalPct * (1 - scoreBlend);

    // Turnover damping: blend 30% toward current weight if position exists
    const currentW = currentWeightMap.get(s.ticker);
    if (currentW !== undefined && currentW > 0) {
      blended = blended * 0.7 + currentW * 0.3;
    }

    return clamp(blended, 2, maxSinglePct);
  });

  // Enforce crypto cap
  let cryptoTotal = 0;
  const cryptoIdx: number[] = [];
  for (let i = 0; i < selected.length; i++) {
    if (ASSET_TYPE_MAP[selected[i]!.ticker] === 'crypto') {
      cryptoTotal += weights[i]!;
      cryptoIdx.push(i);
    }
  }
  const maxCrypto = MAX_CRYPTO_ALLOCATION_PCT * 100;
  if (cryptoTotal > maxCrypto && cryptoIdx.length > 0) {
    const scale = maxCrypto / cryptoTotal;
    for (const idx of cryptoIdx) weights[idx] = weights[idx]! * scale;
  }

  // Normalize
  const totalW = weights.reduce((s, w) => s + w, 0);
  if (totalW > investablePct) {
    const scale = investablePct / totalW;
    weights = weights.map((w) => w * scale);
  }

  const finalTotal = weights.reduce((s, w) => s + w, 0);
  const cashWeightPct = Math.max(100 - finalTotal, CASH_FLOOR_PCT * 100);

  const targetWeights: TargetWeight[] = selected
    .map((s, i) => ({ ticker: s.ticker, weightPct: Math.round(weights[i]! * 100) / 100 }))
    .filter((tw) => tw.weightPct > 0.5);

  // Generate actions
  const rebalanceBand = userParams.riskProfile === 'aggressive' ? 1.5 : userParams.riskProfile === 'conservative' ? 3.0 : 2.0;

  const actions: PortfolioAction[] = [];
  const targetMap = new Map<string, number>();
  for (const tw of targetWeights) targetMap.set(tw.ticker, tw.weightPct);

  const allTickers = new Set<string>();
  for (const h of currentHoldings) allTickers.add(h.ticker);
  for (const tw of targetWeights) allTickers.add(tw.ticker);

  for (const ticker of allTickers) {
    const currentWeight = currentWeightMap.get(ticker) ?? 0;
    const targetWeight = targetMap.get(ticker) ?? 0;
    const delta = targetWeight - currentWeight;
    const score = scores.find((s) => s.ticker === ticker);

    const currentIsZero = currentWeight < NEAR_ZERO_THRESHOLD;
    const targetIsZero = targetWeight < NEAR_ZERO_THRESHOLD;

    let action: OptimizerAction;
    if (targetIsZero && !currentIsZero) action = 'SELL';
    else if (currentIsZero && !targetIsZero) action = 'BUY';
    else if (Math.abs(delta) <= rebalanceBand) action = 'HOLD';
    else if (delta > 0) action = 'ADD';
    else action = 'REDUCE';

    if (action === 'HOLD' && Math.abs(delta) < 0.1) continue;

    let urgency: 'high' | 'medium' | 'low' = 'medium';
    if (action === 'SELL') urgency = 'high';
    else if (Math.abs(delta) > 8) urgency = 'high';
    else if (Math.abs(delta) < 3) urgency = 'low';

    actions.push({
      ticker, action, currentWeightPct: currentWeight, targetWeightPct: targetWeight,
      deltaWeightPct: delta, confidence: score?.confidence ?? 0.5, urgency,
    });
  }

  // Sort: SELL first, then by delta
  const order: Record<OptimizerAction, number> = { SELL: 0, BUY: 1, REDUCE: 2, ADD: 3, HOLD: 4 };
  actions.sort((a, b) => order[a.action] - order[b.action] || Math.abs(b.deltaWeightPct) - Math.abs(a.deltaWeightPct));

  // Limit daily changes
  const nonHold = actions.filter((a) => a.action !== 'HOLD');
  if (nonHold.length > MAX_DAILY_CHANGES) {
    const kept = new Set(nonHold.slice(0, MAX_DAILY_CHANGES).map((a) => a.ticker));
    for (const a of actions) {
      if (a.action !== 'HOLD' && !kept.has(a.ticker)) a.action = 'HOLD';
    }
  }

  return { targetWeights, cashWeightPct, actions };
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

async function loadScores(supabase: SB, dateStr: string): Promise<TickerScore[]> {
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

  const result: TickerScore[] = [];
  for (const [ticker, entry] of byTicker) {
    const w = getWeightsForTicker(ticker, entry.sentimentMissing);
    const composite = entry.technical * w.technical + entry.sentiment * w.sentiment + entry.fundamental * w.fundamental + entry.regime * w.regime;
    result.push({
      ticker, compositeScore: composite, confidence: entry.confidence, dataFreshness: entry.freshness,
      technicalScore: entry.technical, sentimentScore: entry.sentiment, fundamentalScore: entry.fundamental, regimeScore: entry.regime,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// LLM Explanation (Phase 6: synthesis demoted to explanation-only)
// ---------------------------------------------------------------------------

function buildExplanationPrompt(
  actions: PortfolioAction[],
  portfolioNarrative: { totalValue: number; cashPct: number; goalProbPct: number; riskProfile: string },
  macroEvents: string[],
): string {
  const lines: string[] = [];
  lines.push('You are an investment communication writer. The portfolio optimizer has determined the following target changes.');
  lines.push('Your job is to explain WHY these changes make sense in plain language. Do NOT suggest alternatives or override the optimizer.');
  lines.push('');
  lines.push(`Portfolio: $${portfolioNarrative.totalValue.toLocaleString()} | Cash: ${portfolioNarrative.cashPct.toFixed(1)}% | Risk: ${portfolioNarrative.riskProfile}`);
  lines.push('');
  lines.push('OPTIMIZER ACTIONS:');
  for (const a of actions) {
    if (a.action === 'HOLD' && Math.abs(a.deltaWeightPct) < 1) continue;
    lines.push(`${a.action} ${a.ticker}: ${a.currentWeightPct.toFixed(1)}% -> ${a.targetWeightPct.toFixed(1)}% (delta ${a.deltaWeightPct > 0 ? '+' : ''}${a.deltaWeightPct.toFixed(1)}%)`);
  }
  if (macroEvents.length > 0) {
    lines.push('');
    lines.push('RECENT MACRO EVENTS:');
    for (const e of macroEvents) lines.push(`- ${e}`);
  }
  lines.push('');
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
  actions: PortfolioAction[],
  narrativeContext: { totalValue: number; cashPct: number; goalProbPct: number; riskProfile: string },
  macroEvents: string[],
  model: string,
  maxTokens: number,
): Promise<ExplanationOutput | null> {
  try {
    const prompt = buildExplanationPrompt(actions, narrativeContext, macroEvents);
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
// Run synthesis for a single portfolio
// ---------------------------------------------------------------------------

async function runForPortfolio(
  supabase: SB, anthropic: Anthropic, portfolioId: string, userId: string, dateStr: string, allScores: TickerScore[],
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

  // Load current positions
  const { data: positions } = await supabase.from('portfolio_positions').select('ticker, quantity, avg_purchase_price').eq('portfolio_id', portfolioId).eq('is_active', true);

  // Load current prices
  const positionTickers = (positions ?? []).map((p) => p.ticker as string);
  const allTickers = [...new Set([...positionTickers, ...allScores.map((s) => s.ticker)])];
  const { data: priceData } = await supabase.from('price_history').select('ticker, close').in('ticker', allTickers.length > 0 ? allTickers : ['NONE']).order('date', { ascending: false }).limit(2000);

  const prices: Record<string, number> = {};
  for (const row of priceData ?? []) {
    const t = row.ticker as string;
    if (!prices[t]) prices[t] = Number(row.close);
  }

  // Fallback to market_quotes
  const { data: quoteData } = await supabase.from('market_quotes').select('ticker, last_price').in('ticker', allTickers.length > 0 ? allTickers : ['NONE']).order('date', { ascending: false }).limit(2000);
  for (const row of quoteData ?? []) {
    const t = row.ticker as string;
    if (!prices[t]) prices[t] = Number(row.last_price);
  }

  // Load portfolio cash + valuation
  const { data: portfolioData } = await supabase.from('portfolios').select('cash_balance').eq('id', portfolioId).single();
  const cashBalance = portfolioData ? Number(portfolioData.cash_balance ?? 0) : 0;

  // Build current holdings
  const currentHoldings: CurrentHolding[] = [];
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
  // Compute weight percentages
  for (const h of currentHoldings) {
    h.weightPct = totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0;
  }

  // Apply drawdown hard stop (before optimizer)
  for (const h of currentHoldings) {
    const pnlPct = h.avgPurchasePrice > 0 ? (h.currentPrice - h.avgPurchasePrice) / h.avgPurchasePrice : 0;
    if (pnlPct < -maxDrawdownPct) {
      // Force this position to be sold — set its score to -1
      const existingScore = allScores.find((s) => s.ticker === h.ticker);
      if (existingScore) existingScore.compositeScore = -1;
    }
  }

  // Run optimizer
  const optimizerResult = optimizePortfolio(
    allScores, currentHoldings, totalValue, cashBalance,
    { maxPositions, assetTypes: userAssetTypes, riskProfile, volatilityTolerance },
  );

  // Load macro events for explanation context
  const macroStart = new Date(dateStr);
  macroStart.setDate(macroStart.getDate() - 1);
  const { data: macroData } = await supabase.from('macro_events').select('event_description').gte('date', macroStart.toISOString().split('T')[0]!).lte('date', dateStr).order('date', { ascending: false }).limit(5);
  const macroEvents = (macroData ?? []).map((e) => e.event_description as string);

  // Load valuation for goal probability
  const { data: valData } = await supabase.from('portfolio_valuations').select('goal_probability_pct').eq('portfolio_id', portfolioId).order('date', { ascending: false }).limit(1).single();
  const goalProbPct = valData ? Number(valData.goal_probability_pct ?? 50) : 50;

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

  // Generate LLM explanation
  const [synthesisModel, maxTokensSynthesis] = await Promise.all([
    getConfig('model_synthesis', SYNTHESIS_MODEL),
    getConfigNumber('max_tokens_synthesis', 4096),
  ]);

  const explanation = await generateExplanation(
    anthropic, optimizerResult.actions,
    { totalValue, cashPct: optimizerResult.cashWeightPct, goalProbPct, riskProfile },
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

  // Save raw output
  await supabase.from('synthesis_raw_outputs').insert({
    synthesis_run_id: runId,
    raw_llm_output: explanation ?? { optimizerOnly: true },
    post_rules_output: { targetWeights: optimizerResult.targetWeights, actions: optimizerResult.actions },
    overrides_applied: [],
    low_confidence_reasons: llmSucceeded ? [] : ['LLM explanation unavailable — recommendations from optimizer only'],
  });

  // Build narrative
  const narrative = explanation?.portfolioNarrative
    ?? `Optimizer-generated recommendations based on quantitative scores. ${optimizerResult.actions.filter((a) => a.action !== 'HOLD').length} position changes suggested.`;

  const goalStatus = explanation?.goalStatus ?? 'monitor';

  // Create recommendation run
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

  // Validate tickers
  const { data: validAssets } = await supabase.from('assets').select('ticker');
  const validTickers = new Set((validAssets ?? []).map((a) => a.ticker as string));

  // Write recommendation items from optimizer actions
  const validActions = optimizerResult.actions.filter((a) => validTickers.has(a.ticker));
  const itemErrors: string[] = [];

  for (let i = 0; i < validActions.length; i++) {
    const a = validActions[i]!;
    const explanationText = explanation?.actionExplanations?.[a.ticker]
      ?? `Optimizer: ${a.action} ${a.ticker} from ${a.currentWeightPct.toFixed(1)}% to ${a.targetWeightPct.toFixed(1)}%`;

    const { error: itemError } = await supabase.from('recommendation_items').insert({
      run_id: recRunId,
      ticker: a.ticker,
      action: a.action,
      urgency: a.urgency,
      current_allocation_pct: a.currentWeightPct,
      target_allocation_pct: a.targetWeightPct,
      llm_reasoning: explanationText,
      confidence: a.confidence,
      rules_engine_applied: false,
      rules_engine_note: null,
      priority: i + 1,
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
  console.log(`    Done: ${validActions.length} recs, ${llmNote}`);
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

  // Load all scores once (shared across portfolios)
  const allScores = await loadScores(supabase, dateStr);
  console.log(`[Synthesis] Loaded ${allScores.length} ticker scores`);

  const { data: portfolios, error } = await supabase.from('portfolios').select('id, user_id').eq('status', 'active');
  if (error) { console.error('Failed to load portfolios:', error.message); process.exit(1); }
  if (!portfolios || portfolios.length === 0) { console.log('[Synthesis] No active portfolios'); return; }

  console.log(`[Synthesis] Processing ${portfolios.length} portfolio(s)`);

  let success = 0, errors = 0;
  for (const portfolio of portfolios) {
    try {
      // Pass a copy of scores so per-portfolio mutations don't affect others
      const scoresCopy = allScores.map((s) => ({ ...s }));
      const result = await runForPortfolio(supabase, anthropic, portfolio.id as string, portfolio.user_id as string, dateStr, scoresCopy);
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
