/**
 * Candidate Selection — filter and rank eligible tickers for the optimizer.
 */
import type { TickerScore, OptimizerUserParams } from './types.js';
import { ASSET_TYPE_MAP } from '../../shared/lib/constants.js';
import type { AssetType } from '../../shared/types/assets.js';

/**
 * Filter and rank candidate tickers based on user preferences and scores.
 * Returns the top N tickers sorted by composite score.
 */
export function selectCandidates(
  allScores: TickerScore[],
  userParams: OptimizerUserParams,
  currentHoldingTickers: Set<string>,
  maxCandidates?: number,
): string[] {
  const max = maxCandidates ?? userParams.maxPositions * 3;

  // Filter by allowed asset types
  const filtered = allScores.filter((s) => {
    const type = ASSET_TYPE_MAP[s.ticker] as AssetType | undefined;
    if (!type) return false;
    return userParams.assetTypes.includes(type);
  });

  // Always include current holdings (even if score is bad — optimizer decides to sell)
  const currentHeld = filtered.filter((s) => currentHoldingTickers.has(s.ticker));
  const notHeld = filtered.filter((s) => !currentHoldingTickers.has(s.ticker));

  // Sort non-held by composite score descending
  notHeld.sort((a, b) => b.compositeScore - a.compositeScore);

  // Take top candidates, but always include current holdings
  const remaining = Math.max(0, max - currentHeld.length);
  const candidates = [
    ...currentHeld.map((s) => s.ticker),
    ...notHeld.slice(0, remaining).map((s) => s.ticker),
  ];

  return [...new Set(candidates)];
}
