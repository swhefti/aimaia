/**
 * Constraints — hard constraint checks and configuration derivation.
 */
import type { OptimizerConfig, OptimizerUserParams } from './types.js';
import {
  MAX_POSITION_PCT,
  MAX_CRYPTO_ALLOCATION_PCT,
  CASH_FLOOR_PCT,
} from '../../shared/lib/constants.js';

/**
 * Derive optimizer config from user risk profile / volatility tolerance.
 */
export function deriveConfig(params: OptimizerUserParams): OptimizerConfig {
  const { riskProfile, volatilityTolerance } = params;

  // Risk penalty: higher = more risk-averse
  let riskPenalty = 2.0;
  if (riskProfile === 'conservative') riskPenalty = 4.0;
  else if (riskProfile === 'aggressive') riskPenalty = 1.0;

  if (volatilityTolerance === 'moderate') riskPenalty *= 1.3;
  else if (volatilityTolerance === 'tolerant') riskPenalty *= 0.7;

  // Concentration penalty: higher = prefer diversification
  let concentrationPenalty = 0.5;
  if (riskProfile === 'conservative') concentrationPenalty = 1.0;
  else if (riskProfile === 'aggressive') concentrationPenalty = 0.2;

  // Turnover penalty: penalize changes for existing portfolios
  const turnoverPenalty = 0.3;

  // Rebalance band: minimum delta to trigger an action
  let rebalanceBandPct = 2.0; // 2% absolute
  if (riskProfile === 'aggressive') rebalanceBandPct = 1.5;
  if (riskProfile === 'conservative') rebalanceBandPct = 3.0;

  // Minimum position size to avoid tiny allocations
  const minPositionPct = 2.0;

  return {
    riskPenalty,
    concentrationPenalty,
    turnoverPenalty,
    rebalanceBandPct,
    minPositionPct,
  };
}

/**
 * Enforce hard constraints on a set of weights. Returns clamped weights.
 * This is called during and after optimization to ensure feasibility.
 */
export function enforceHardConstraints(
  weights: Map<string, number>,
  assetTypeMap: Record<string, string>,
  maxPositions: number,
): { weights: Map<string, number>; cashPct: number; constraintsActive: string[] } {
  const constraintsActive: string[] = [];
  const result = new Map(weights);
  const maxSinglePct = MAX_POSITION_PCT * 100;
  const cashFloorPct = CASH_FLOOR_PCT * 100;
  const maxCryptoPct = MAX_CRYPTO_ALLOCATION_PCT * 100;

  // 1. Cap individual positions
  for (const [ticker, w] of result) {
    if (w > maxSinglePct) {
      result.set(ticker, maxSinglePct);
      constraintsActive.push(`position_cap:${ticker}`);
    }
    if (w < 0) result.set(ticker, 0);
  }

  // 2. Enforce max positions: zero out smallest allocations beyond max
  const sorted = [...result.entries()]
    .filter(([, w]) => w > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length > maxPositions) {
    constraintsActive.push('max_positions');
    for (let i = maxPositions; i < sorted.length; i++) {
      result.set(sorted[i]![0], 0);
    }
  }

  // 3. Enforce crypto cap
  let cryptoTotal = 0;
  const cryptoTickers: string[] = [];
  for (const [ticker, w] of result) {
    if (assetTypeMap[ticker] === 'crypto' && w > 0) {
      cryptoTotal += w;
      cryptoTickers.push(ticker);
    }
  }
  if (cryptoTotal > maxCryptoPct && cryptoTickers.length > 0) {
    constraintsActive.push('crypto_cap');
    const scale = maxCryptoPct / cryptoTotal;
    for (const ticker of cryptoTickers) {
      result.set(ticker, (result.get(ticker) ?? 0) * scale);
    }
  }

  // 4. Ensure cash floor
  let totalWeightPct = 0;
  for (const [, w] of result) totalWeightPct += w;

  let cashPct = 100 - totalWeightPct;
  if (cashPct < cashFloorPct) {
    constraintsActive.push('cash_floor');
    // Scale down all positions proportionally
    const scale = (100 - cashFloorPct) / totalWeightPct;
    for (const [ticker, w] of result) {
      result.set(ticker, w * scale);
    }
    cashPct = cashFloorPct;
  }

  return { weights: result, cashPct, constraintsActive };
}
