/**
 * Expected Returns — derive annualized expected returns from agent scores.
 *
 * Approach:
 * - Map composite score [-1, 1] to annualized expected return
 * - Shrink toward zero when confidence is low or data is stale
 * - Apply regime adjustment
 */
import type { TickerScore } from './types.js';

/** Base annual return mapped from score. Score of +1 → ~30% annualized, -1 → -30%. */
const BASE_RETURN_SCALE = 0.30;

/** Minimum confidence below which expected return is heavily damped. */
const LOW_CONFIDENCE_THRESHOLD = 0.3;

export function computeExpectedReturns(
  scores: TickerScore[],
): Map<string, number> {
  const result = new Map<string, number>();

  for (const s of scores) {
    let mu = s.compositeScore * BASE_RETURN_SCALE;

    // Shrink toward zero for low confidence
    const confMultiplier = s.confidence < LOW_CONFIDENCE_THRESHOLD
      ? s.confidence / LOW_CONFIDENCE_THRESHOLD * 0.5  // heavy shrinkage
      : 0.5 + (s.confidence - LOW_CONFIDENCE_THRESHOLD) / (1 - LOW_CONFIDENCE_THRESHOLD) * 0.5;
    mu *= confMultiplier;

    // Penalize stale/missing data
    if (s.dataFreshness === 'stale') mu *= 0.7;
    if (s.dataFreshness === 'missing') mu *= 0.3;

    result.set(s.ticker, mu);
  }

  return result;
}
