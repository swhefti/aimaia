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
  // Configurable constants — defaults match original hardcoded values
  sigmoidMidpoint?: number | undefined;
  sigmoidSteepness?: number | undefined;
  aiScoreWeight?: number | undefined;
  progressBonusMax?: number | undefined;
  diversificationBonusMax?: number | undefined;
  timeBonusMax?: number | undefined;
  noPositionsCap?: number | undefined;
}): number {
  const {
    cumulativeReturn,
    goalReturn,
    monthsRemaining,
    avgCompositeScore,
    positionCount = 0,
    maxPositions = 10,
    riskProfile = 'balanced',
    sigmoidMidpoint = 0.10,
    sigmoidSteepness = 6,
    aiScoreWeight = 4,
    progressBonusMax = 8,
    diversificationBonusMax = 3,
    timeBonusMax = 4,
    noPositionsCap = 40,
  } = opts;

  // 1. Progress factor: how far along are we toward the goal?
  const progressRatio = goalReturn > 0
    ? cumulativeReturn / goalReturn
    : (cumulativeReturn >= 0 ? 1.5 : 0.5);

  // 2. Remaining return needed, annualized
  const remainingNeeded = goalReturn - cumulativeReturn;
  const annualizedNeeded = monthsRemaining > 0
    ? (remainingNeeded / monthsRemaining) * 12
    : (remainingNeeded <= 0 ? -1 : 1);

  // 3. Base probability from sigmoid (smoother curve)
  const sigmoid = 1 / (1 + Math.exp(sigmoidSteepness * (annualizedNeeded - sigmoidMidpoint)));
  let baseProbability = sigmoid * 100;

  // 4. Progress bonus (ahead of schedule)
  if (progressRatio > 0 && monthsRemaining > 0) {
    const elapsedRatio = Math.max(0, 1 - (monthsRemaining / Math.max(monthsRemaining + 1, 12)));
    if (progressRatio > elapsedRatio) {
      const bonus = Math.min(progressBonusMax, (progressRatio - elapsedRatio) * 15);
      baseProbability += bonus;
    }
  }

  // 5. AI score momentum (dampened to avoid daily volatility)
  if (avgCompositeScore !== undefined) {
    const scoreFactor = avgCompositeScore * aiScoreWeight;
    baseProbability += scoreFactor;
  }

  // 6. Diversification factor (smooth ramp instead of hard cap)
  if (positionCount === 0 && goalReturn > 0) {
    baseProbability = Math.min(baseProbability, noPositionsCap);
  } else if (positionCount > 0) {
    const diversificationRatio = Math.min(positionCount / Math.max(maxPositions, 1), 1);
    baseProbability += diversificationRatio * diversificationBonusMax;
  }

  // 7. Risk profile adjustment
  if (riskProfile === 'aggressive' && annualizedNeeded > 0.05) {
    baseProbability += 2;
  } else if (riskProfile === 'conservative' && annualizedNeeded < 0.05) {
    baseProbability += 1.5;
  }

  // 8. Time factor (more time = more chance to recover)
  if (monthsRemaining > 12 && remainingNeeded > 0) {
    baseProbability += Math.min(timeBonusMax, (monthsRemaining - 12) / 12 * 1.5);
  }

  return Math.round(Math.min(99, Math.max(1, baseProbability)) * 10) / 10;
}
