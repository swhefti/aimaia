/**
 * Solve — the core portfolio optimizer.
 *
 * Uses a pragmatic iterative greedy approach (not full QP):
 * 1. Start with equal-weight allocation across top candidates
 * 2. Iteratively shift weight toward higher expected-return tickers
 * 3. Apply risk penalty (portfolio variance), concentration penalty (HHI),
 *    and turnover penalty (distance from current weights)
 * 4. Enforce hard constraints after each iteration
 *
 * This is intentionally not a full quadratic programming solver — it's
 * deterministic, fast, and produces defensible allocations.
 */
import type { OptimizerConfig, OptimizerInput, TargetWeight, OptimizerRiskMetrics } from './types.js';
import { computeExpectedReturns } from './expected-returns.js';
import { computeCovarianceMatrix, portfolioVariance, covKey } from './covariance.js';
import { enforceHardConstraints } from './constraints.js';
import { ASSET_TYPE_MAP, CASH_FLOOR_PCT } from '../../shared/lib/constants.js';

const MAX_ITERATIONS = 50;
const CONVERGENCE_THRESHOLD = 0.01; // weight change threshold

interface SolveResult {
  targetWeights: TargetWeight[];
  cashWeightPct: number;
  riskMetrics: OptimizerRiskMetrics;
  metadata: {
    solverIterations: number;
    objectiveValue: number;
    candidatesConsidered: number;
    constraintsActive: string[];
  };
}

export function solve(input: OptimizerInput, config: OptimizerConfig): SolveResult {
  const { candidateTickers, scores, historicalReturns, userParams, currentHoldings, totalPortfolioValue } = input;

  if (candidateTickers.length === 0) {
    return emptyResult();
  }

  // 1. Compute expected returns
  const expectedReturns = computeExpectedReturns(scores);

  // 2. Compute covariance matrix
  const { matrix: covMatrix, volatilities } = computeCovarianceMatrix(candidateTickers, historicalReturns);

  // 3. Build current weights map
  const currentWeights = new Map<string, number>();
  for (const h of currentHoldings) {
    if (candidateTickers.includes(h.ticker)) {
      currentWeights.set(h.ticker, h.weightPct);
    }
  }

  // 4. Initialize weights — blend of score-proportional and equal-weight
  const investablePct = 100 - CASH_FLOOR_PCT * 100;
  let weights = initializeWeights(candidateTickers, expectedReturns, userParams.maxPositions, investablePct, config.minPositionPct);

  // 5. Iterative optimization
  let bestObjective = -Infinity;
  let bestWeights = new Map(weights);
  let iterations = 0;
  let constraintsActive: string[] = [];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    iterations = iter + 1;

    // Compute objective for current weights
    const obj = computeObjective(
      candidateTickers, weights, expectedReturns, covMatrix,
      currentWeights, config, totalPortfolioValue > 0,
    );

    if (obj > bestObjective) {
      bestObjective = obj;
      bestWeights = new Map(weights);
    }

    // Gradient-free optimization: try shifting weight from worst to best ticker
    const { improved, newWeights } = tryImprove(
      candidateTickers, weights, expectedReturns, covMatrix,
      currentWeights, config, totalPortfolioValue > 0,
    );

    if (!improved) break;

    // Enforce hard constraints
    const constrained = enforceHardConstraints(
      newWeights,
      ASSET_TYPE_MAP as Record<string, string>,
      userParams.maxPositions,
    );
    weights = constrained.weights;
    constraintsActive = constrained.constraintsActive;

    // Check convergence
    let maxDelta = 0;
    for (const ticker of candidateTickers) {
      const delta = Math.abs((weights.get(ticker) ?? 0) - (bestWeights.get(ticker) ?? 0));
      if (delta > maxDelta) maxDelta = delta;
    }
    if (maxDelta < CONVERGENCE_THRESHOLD && iter > 5) break;
  }

  // Final constraint enforcement
  const finalConstrained = enforceHardConstraints(
    bestWeights,
    ASSET_TYPE_MAP as Record<string, string>,
    userParams.maxPositions,
  );
  bestWeights = finalConstrained.weights;
  constraintsActive = finalConstrained.constraintsActive;

  // Clean up tiny positions
  for (const [ticker, w] of bestWeights) {
    if (w < config.minPositionPct) bestWeights.set(ticker, 0);
  }

  // Compute final cash
  let totalWeightPct = 0;
  for (const [, w] of bestWeights) totalWeightPct += w;
  const cashWeightPct = Math.max(100 - totalWeightPct, CASH_FLOOR_PCT * 100);

  // Build target weights array (only non-zero)
  const targetWeights: TargetWeight[] = [];
  for (const [ticker, w] of bestWeights) {
    if (w > 0.01) {
      targetWeights.push({ ticker, weightPct: Math.round(w * 100) / 100 });
    }
  }
  targetWeights.sort((a, b) => b.weightPct - a.weightPct);

  // Compute risk metrics
  const riskMetrics = computeRiskMetrics(
    candidateTickers, bestWeights, expectedReturns, covMatrix, volatilities,
  );

  return {
    targetWeights,
    cashWeightPct: Math.round(cashWeightPct * 100) / 100,
    riskMetrics,
    metadata: {
      solverIterations: iterations,
      objectiveValue: bestObjective,
      candidatesConsidered: candidateTickers.length,
      constraintsActive,
    },
  };
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function initializeWeights(
  tickers: string[],
  expectedReturns: Map<string, number>,
  maxPositions: number,
  investablePct: number,
  minPositionPct: number,
): Map<string, number> {
  const weights = new Map<string, number>();

  // Rank tickers by expected return
  const ranked = [...tickers]
    .map((t) => ({ ticker: t, mu: expectedReturns.get(t) ?? 0 }))
    .sort((a, b) => b.mu - a.mu);

  // Select top N (max positions)
  const selected = ranked.slice(0, maxPositions);
  if (selected.length === 0) return weights;

  // Score-proportional allocation (shift so all positive)
  const minMu = Math.min(...selected.map((s) => s.mu));
  const shift = minMu < 0.001 ? Math.abs(minMu) + 0.001 : 0;
  const shifted = selected.map((s) => s.mu + shift);
  const totalShifted = shifted.reduce((sum, v) => sum + v, 0);

  const equalPct = investablePct / selected.length;

  for (let i = 0; i < selected.length; i++) {
    const s = selected[i]!;
    // Blend 60% score-proportional + 40% equal-weight for stability
    const scorePct = totalShifted > 0 ? (shifted[i]! / totalShifted) * investablePct : equalPct;
    const blended = scorePct * 0.6 + equalPct * 0.4;
    weights.set(s.ticker, Math.max(blended, minPositionPct));
  }

  // Set zero for non-selected
  for (const t of tickers) {
    if (!weights.has(t)) weights.set(t, 0);
  }

  return weights;
}

function computeObjective(
  tickers: string[],
  weights: Map<string, number>,
  expectedReturns: Map<string, number>,
  covMatrix: Map<string, number>,
  currentWeights: Map<string, number>,
  config: OptimizerConfig,
  isExistingPortfolio: boolean,
): number {
  // Expected return component
  let expRet = 0;
  for (const t of tickers) {
    expRet += (weights.get(t) ?? 0) / 100 * (expectedReturns.get(t) ?? 0);
  }

  // Risk penalty (portfolio variance)
  const weightsDecimal = new Map<string, number>();
  for (const t of tickers) weightsDecimal.set(t, (weights.get(t) ?? 0) / 100);
  const pVar = portfolioVariance(tickers, weightsDecimal, covMatrix);
  const riskPenalty = config.riskPenalty * pVar;

  // Concentration penalty (HHI)
  let hhi = 0;
  for (const t of tickers) {
    const w = (weights.get(t) ?? 0) / 100;
    hhi += w * w;
  }
  const concPenalty = config.concentrationPenalty * hhi;

  // Turnover penalty (only for existing portfolios)
  let turnover = 0;
  if (isExistingPortfolio) {
    for (const t of tickers) {
      turnover += Math.abs((weights.get(t) ?? 0) - (currentWeights.get(t) ?? 0));
    }
    turnover /= 100; // normalize to [0, ~2]
  }
  const turnPenalty = config.turnoverPenalty * turnover;

  return expRet - riskPenalty - concPenalty - turnPenalty;
}

function tryImprove(
  tickers: string[],
  weights: Map<string, number>,
  expectedReturns: Map<string, number>,
  covMatrix: Map<string, number>,
  currentWeights: Map<string, number>,
  config: OptimizerConfig,
  isExistingPortfolio: boolean,
): { improved: boolean; newWeights: Map<string, number> } {
  const currentObj = computeObjective(
    tickers, weights, expectedReturns, covMatrix,
    currentWeights, config, isExistingPortfolio,
  );

  const STEP_SIZE = 1.0; // shift 1% at a time
  let bestObj = currentObj;
  let bestWeights = new Map(weights);

  // Try shifting weight between all pairs (greedy)
  const activeTickers = tickers.filter((t) => (weights.get(t) ?? 0) > 0 || (expectedReturns.get(t) ?? 0) > 0);

  for (const from of activeTickers) {
    const wFrom = weights.get(from) ?? 0;
    if (wFrom < STEP_SIZE) continue;

    for (const to of activeTickers) {
      if (from === to) continue;

      const trial = new Map(weights);
      trial.set(from, wFrom - STEP_SIZE);
      trial.set(to, (trial.get(to) ?? 0) + STEP_SIZE);

      const obj = computeObjective(
        tickers, trial, expectedReturns, covMatrix,
        currentWeights, config, isExistingPortfolio,
      );

      if (obj > bestObj + 0.0001) {
        bestObj = obj;
        bestWeights = trial;
      }
    }
  }

  return {
    improved: bestObj > currentObj + 0.0001,
    newWeights: bestWeights,
  };
}

function computeRiskMetrics(
  tickers: string[],
  weights: Map<string, number>,
  expectedReturns: Map<string, number>,
  covMatrix: Map<string, number>,
  volatilities: Map<string, number>,
): OptimizerRiskMetrics {
  // Expected portfolio return
  let expRet = 0;
  for (const t of tickers) {
    expRet += (weights.get(t) ?? 0) / 100 * (expectedReturns.get(t) ?? 0);
  }

  // Portfolio volatility
  const weightsDecimal = new Map<string, number>();
  for (const t of tickers) weightsDecimal.set(t, (weights.get(t) ?? 0) / 100);
  const pVar = portfolioVariance(tickers, weightsDecimal, covMatrix);
  const portfolioVol = Math.sqrt(Math.max(0, pVar));

  // Concentration risk (HHI)
  let hhi = 0;
  let activePositions = 0;
  for (const t of tickers) {
    const w = (weights.get(t) ?? 0) / 100;
    if (w > 0.001) {
      hhi += w * w;
      activePositions++;
    }
  }
  const maxHhi = activePositions > 0 ? 1 : 0;
  const minHhi = activePositions > 0 ? 1 / activePositions : 0;
  const concentrationRisk = maxHhi > minHhi
    ? Math.min(1, (hhi - minHhi) / (maxHhi - minHhi))
    : 0;

  // Diversification score (inverse of concentration)
  const diversificationScore = 1 - concentrationRisk;

  // Max drawdown estimate (rough: 2 * vol * sqrt(holding_period_fraction))
  const maxDrawdownEstimate = Math.min(0.5, portfolioVol * 2);

  // Crypto allocation
  let cryptoAllocationPct = 0;
  for (const t of tickers) {
    if (ASSET_TYPE_MAP[t] === 'crypto') {
      cryptoAllocationPct += weights.get(t) ?? 0;
    }
  }

  return {
    expectedPortfolioReturn: expRet,
    portfolioVolatility: portfolioVol,
    concentrationRisk,
    diversificationScore,
    maxDrawdownEstimate,
    cryptoAllocationPct,
  };
}

function emptyResult(): SolveResult {
  return {
    targetWeights: [],
    cashWeightPct: 100,
    riskMetrics: {
      expectedPortfolioReturn: 0,
      portfolioVolatility: 0,
      concentrationRisk: 0,
      diversificationScore: 1,
      maxDrawdownEstimate: 0,
      cryptoAllocationPct: 0,
    },
    metadata: {
      solverIterations: 0,
      objectiveValue: 0,
      candidatesConsidered: 0,
      constraintsActive: [],
    },
  };
}
