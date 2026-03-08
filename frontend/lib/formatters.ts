import type { GoalStatus } from '@shared/types/portfolio';

export function formatCurrency(value: number): string {
  const absValue = Math.abs(value);
  const decimals = absValue > 0 && absValue < 10 ? 2 : 0;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatPct(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

export function formatScore(score: number): string {
  const sign = score >= 0 ? '+' : '';
  return `${sign}${score.toFixed(2)}`;
}

export function scoreToSignal(score: number): string {
  if (score >= 0.60) return 'Strong Buy';
  if (score >= 0.20) return 'Buy';
  if (score >= -0.19) return 'Hold';
  if (score >= -0.59) return 'Sell';
  return 'Strong Sell';
}

export function scoreToColor(score: number): string {
  if (score >= 0.60) return 'text-emerald-400';
  if (score >= 0.20) return 'text-green-400';
  if (score >= -0.19) return 'text-gray-400';
  if (score >= -0.59) return 'text-orange-400';
  return 'text-red-400';
}

export function scoreToColorBg(score: number): string {
  if (score >= 0.60) return 'bg-emerald-500/20 text-emerald-400';
  if (score >= 0.20) return 'bg-green-500/20 text-green-400';
  if (score >= -0.19) return 'bg-gray-500/20 text-gray-400';
  if (score >= -0.59) return 'bg-orange-500/20 text-orange-400';
  return 'bg-red-500/20 text-red-400';
}

export function probabilityToGoalStatus(pct: number): GoalStatus {
  if (pct >= 70) return 'on_track';
  if (pct >= 45) return 'monitor';
  if (pct >= 25) return 'at_risk';
  return 'off_track';
}

export function confidenceToLabel(c: number): 'High' | 'Medium' | 'Low' {
  if (c >= 0.7) return 'High';
  if (c >= 0.4) return 'Medium';
  return 'Low';
}

export function goalStatusToColor(s: GoalStatus): string {
  switch (s) {
    case 'on_track': return 'text-emerald-400';
    case 'monitor': return 'text-amber-400';
    case 'at_risk': return 'text-orange-400';
    case 'off_track': return 'text-red-400';
  }
}

export function goalStatusToLabel(s: GoalStatus): string {
  switch (s) {
    case 'on_track': return 'On Track';
    case 'monitor': return 'Monitor';
    case 'at_risk': return 'At Risk';
    case 'off_track': return 'Off Track';
  }
}

export function urgencyToLabel(u: string): string {
  switch (u) {
    case 'high': return 'Today';
    case 'medium': return 'This Week';
    case 'low': return 'Consider';
    default: return u;
  }
}

export function urgencyToColor(u: string): string {
  switch (u) {
    case 'high': return 'bg-red-500/20 text-red-400';
    case 'medium': return 'bg-amber-500/20 text-amber-400';
    case 'low': return 'bg-blue-500/20 text-blue-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
}

/**
 * Compute a granular goal probability (0–100) based on portfolio metrics.
 *
 * Inputs:
 *  - cumulativeReturn: current total return as decimal (e.g. 0.05 = 5%)
 *  - goalReturn: target return as decimal (e.g. 0.10 = 10%)
 *  - monthsRemaining: months left in the investment horizon
 *  - avgCompositeScore: average AI composite score of held positions (-1 to 1), or undefined
 *  - positionCount: number of positions held
 *  - maxPositions: user's configured max positions
 *  - riskProfile: 'conservative' | 'balanced' | 'aggressive'
 */
export function computeGoalProbability(opts: {
  cumulativeReturn: number;
  goalReturn: number;
  monthsRemaining: number;
  avgCompositeScore?: number | undefined;
  positionCount?: number | undefined;
  maxPositions?: number | undefined;
  riskProfile?: string | undefined;
}): number {
  const {
    cumulativeReturn,
    goalReturn,
    monthsRemaining,
    avgCompositeScore,
    positionCount = 0,
    maxPositions = 10,
    riskProfile = 'balanced',
  } = opts;

  // 1. Progress factor: how far along are we toward the goal?
  //    If goal is 0 or already exceeded, progress = 1+
  const progressRatio = goalReturn > 0
    ? cumulativeReturn / goalReturn
    : (cumulativeReturn >= 0 ? 1.5 : 0.5);

  // 2. Remaining return needed, annualized
  const remainingNeeded = goalReturn - cumulativeReturn;
  const annualizedNeeded = monthsRemaining > 0
    ? (remainingNeeded / monthsRemaining) * 12
    : (remainingNeeded <= 0 ? -1 : 1);

  // 3. Base probability from a sigmoid centered around the difficulty of the remaining goal
  //    - annualizedNeeded <= 0: already achieved → high probability
  //    - annualizedNeeded ~0.08 (8% annual): moderate difficulty → ~60%
  //    - annualizedNeeded > 0.30: very hard → low probability
  //    Sigmoid: P = 1 / (1 + e^(k * (annualizedNeeded - midpoint)))
  const midpoint = 0.08; // 8% annualized is the "50/50" point
  const steepness = 12;   // controls how sharply probability drops
  const sigmoid = 1 / (1 + Math.exp(steepness * (annualizedNeeded - midpoint)));
  let baseProbability = sigmoid * 100;

  // 4. Progress bonus: if already ahead of schedule, boost probability
  if (progressRatio > 0 && monthsRemaining > 0) {
    // Expected progress at this point (linear interpolation)
    // If original horizon is not available, estimate from remaining months
    const elapsedRatio = Math.max(0, 1 - (monthsRemaining / Math.max(monthsRemaining + 1, 12)));
    if (progressRatio > elapsedRatio && progressRatio > 0) {
      const bonus = Math.min(10, (progressRatio - elapsedRatio) * 20);
      baseProbability += bonus;
    }
  }

  // 5. AI score momentum bonus/penalty (-5 to +8 points)
  if (avgCompositeScore !== undefined) {
    // Score ranges from -1 to +1. Positive scores = tailwind
    const scoreFactor = avgCompositeScore * 8; // -8 to +8
    baseProbability += scoreFactor;
  }

  // 6. Diversification factor: having positions is better than all cash
  if (positionCount === 0 && goalReturn > 0) {
    // No positions = low chance of hitting a positive return goal
    baseProbability = Math.min(baseProbability, 35);
  } else if (positionCount > 0) {
    // Mild bonus for diversification (up to +3 points)
    const diversificationRatio = Math.min(positionCount / Math.max(maxPositions, 1), 1);
    baseProbability += diversificationRatio * 3;
  }

  // 7. Risk profile adjustment: aggressive profiles need higher returns
  //    which are inherently less certain, but they accept that
  if (riskProfile === 'aggressive' && annualizedNeeded > 0.05) {
    baseProbability += 3; // slight optimism for aggressive strategies
  } else if (riskProfile === 'conservative' && annualizedNeeded < 0.05) {
    baseProbability += 2; // conservative goals are more achievable
  }

  // 8. Time factor: more time = more opportunity (mild bonus if > 12 months)
  if (monthsRemaining > 12 && remainingNeeded > 0) {
    baseProbability += Math.min(5, (monthsRemaining - 12) / 12 * 2);
  }

  // Clamp to 1–99 (never show 0% or 100%)
  return Math.round(Math.min(99, Math.max(1, baseProbability)) * 10) / 10;
}
