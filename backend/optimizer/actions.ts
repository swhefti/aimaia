/**
 * Actions — deterministic action generation from target-vs-current weight deltas.
 *
 * Action mapping:
 * - BUY:    current weight ~0, target weight > rebalance band
 * - ADD:    target > current + rebalance band
 * - REDUCE: current > target + rebalance band
 * - SELL:   target ~0 (or hard risk rule exit)
 * - HOLD:   |target - current| <= rebalance band
 */
import type { PortfolioAction, OptimizerAction, TargetWeight, CurrentHolding, OptimizerConfig, TickerScore } from './types.js';

const NEAR_ZERO_THRESHOLD = 0.5; // 0.5% or less is effectively zero

export function generateActions(
  targetWeights: TargetWeight[],
  currentHoldings: CurrentHolding[],
  config: OptimizerConfig,
  scores: TickerScore[],
): PortfolioAction[] {
  const actions: PortfolioAction[] = [];
  const band = config.rebalanceBandPct;

  // Build lookup maps
  const currentMap = new Map<string, CurrentHolding>();
  for (const h of currentHoldings) currentMap.set(h.ticker, h);

  const targetMap = new Map<string, number>();
  for (const tw of targetWeights) targetMap.set(tw.ticker, tw.weightPct);

  const scoreMap = new Map<string, TickerScore>();
  for (const s of scores) scoreMap.set(s.ticker, s);

  // Process all tickers (union of current + target)
  const allTickers = new Set<string>();
  for (const h of currentHoldings) allTickers.add(h.ticker);
  for (const tw of targetWeights) allTickers.add(tw.ticker);

  for (const ticker of allTickers) {
    const currentWeight = currentMap.get(ticker)?.weightPct ?? 0;
    const targetWeight = targetMap.get(ticker) ?? 0;
    const delta = targetWeight - currentWeight;
    const score = scoreMap.get(ticker);
    const confidence = score?.confidence ?? 0.5;

    const action = classifyAction(currentWeight, targetWeight, delta, band);
    const urgency = deriveUrgency(action, Math.abs(delta), confidence);

    // Skip HOLD actions that are truly trivial (already near target)
    if (action === 'HOLD' && Math.abs(delta) < 0.1) continue;

    actions.push({
      ticker,
      action,
      currentWeightPct: Math.round(currentWeight * 100) / 100,
      targetWeightPct: Math.round(targetWeight * 100) / 100,
      deltaWeightPct: Math.round(delta * 100) / 100,
      confidence,
      urgency,
    });
  }

  // Sort: SELL first (highest priority), then by absolute delta descending
  const actionOrder: Record<OptimizerAction, number> = {
    SELL: 0,
    BUY: 1,
    REDUCE: 2,
    ADD: 3,
    HOLD: 4,
  };

  actions.sort((a, b) => {
    const orderDiff = actionOrder[a.action] - actionOrder[b.action];
    if (orderDiff !== 0) return orderDiff;
    return Math.abs(b.deltaWeightPct) - Math.abs(a.deltaWeightPct);
  });

  return actions;
}

function classifyAction(
  currentWeight: number,
  targetWeight: number,
  delta: number,
  band: number,
): OptimizerAction {
  const currentIsZero = currentWeight < NEAR_ZERO_THRESHOLD;
  const targetIsZero = targetWeight < NEAR_ZERO_THRESHOLD;

  // SELL: target is ~0 and we currently hold
  if (targetIsZero && !currentIsZero) return 'SELL';

  // BUY: we don't hold and target is material
  if (currentIsZero && !targetIsZero) return 'BUY';

  // HOLD: within rebalance band
  if (Math.abs(delta) <= band) return 'HOLD';

  // ADD or REDUCE based on direction
  if (delta > 0) return 'ADD';
  return 'REDUCE';
}

function deriveUrgency(
  action: OptimizerAction,
  absDelta: number,
  confidence: number,
): 'high' | 'medium' | 'low' {
  if (action === 'SELL') return 'high';
  if (action === 'BUY' && absDelta > 5 && confidence > 0.5) return 'high';
  if (absDelta > 8) return 'high';
  if (absDelta > 3 || confidence > 0.6) return 'medium';
  return 'low';
}
