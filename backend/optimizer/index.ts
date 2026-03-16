/**
 * Portfolio Optimizer — main entry point.
 *
 * Used by both:
 *   1. Onboarding — initial portfolio construction (no current holdings)
 *   2. Daily management — re-optimization of existing portfolios
 */
export { solve } from './solve.js';
export { generateActions } from './actions.js';
export { selectCandidates } from './candidate-selection.js';
export { deriveConfig, enforceHardConstraints } from './constraints.js';
export { computeExpectedReturns } from './expected-returns.js';
export { computeCovarianceMatrix } from './covariance.js';
export { computePortfolioRiskMetrics } from './risk-metrics.js';
export type {
  OptimizerInput,
  OptimizerResult,
  OptimizerUserParams,
  OptimizerConfig,
  TargetWeight,
  PortfolioAction,
  OptimizerAction,
  CurrentHolding,
  TickerScore,
  OptimizerRiskMetrics,
} from './types.js';

import type { OptimizerInput, OptimizerResult, OptimizerUserParams, CurrentHolding, TickerScore } from './types.js';
import { solve } from './solve.js';
import { generateActions } from './actions.js';
import { selectCandidates } from './candidate-selection.js';
import { deriveConfig } from './constraints.js';

/**
 * Run the full optimizer pipeline:
 * 1. Select candidates
 * 2. Derive config from user profile
 * 3. Solve for target weights
 * 4. Generate deterministic actions
 */
export function runOptimizer(
  userParams: OptimizerUserParams,
  allScores: TickerScore[],
  currentHoldings: CurrentHolding[],
  cashBalance: number,
  totalPortfolioValue: number,
  historicalReturns: Map<string, number[]>,
): OptimizerResult {
  // 1. Select candidates
  const currentTickers = new Set(currentHoldings.map((h) => h.ticker));
  const candidateTickers = selectCandidates(allScores, userParams, currentTickers);

  // 2. Derive optimizer config from user risk profile
  const config = deriveConfig(userParams);

  // 3. Filter scores to candidates only
  const candidateScores = allScores.filter((s) => candidateTickers.includes(s.ticker));

  // 4. Build optimizer input
  const input: OptimizerInput = {
    userParams,
    currentHoldings: currentHoldings.filter((h) => candidateTickers.includes(h.ticker)),
    cashBalance,
    totalPortfolioValue,
    scores: candidateScores,
    historicalReturns,
    candidateTickers,
  };

  // 5. Solve
  const solveResult = solve(input, config);

  // 6. Generate deterministic actions
  const actions = generateActions(
    solveResult.targetWeights,
    currentHoldings,
    config,
    allScores,
  );

  return {
    ...solveResult,
    actions,
  };
}
