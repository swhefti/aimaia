/**
 * Risk Metrics — compute minimal practical risk metrics for a portfolio.
 */
import type { PortfolioRiskMetrics } from '../../shared/types/portfolio.js';

interface PositionForMetrics {
  ticker: string;
  weightPct: number; // 0–100
  currentValue: number;
}

/**
 * Compute portfolio risk metrics from positions and historical returns.
 */
export function computePortfolioRiskMetrics(
  portfolioId: string,
  date: string,
  positions: PositionForMetrics[],
  historicalReturns: Map<string, number[]>,
  portfolioValuations?: { date: string; totalValue: number }[],
): PortfolioRiskMetrics {
  return {
    portfolioId,
    date,
    volatility: computeRealizedVolatility(positions, historicalReturns),
    maxDrawdownPct: computeMaxDrawdown(portfolioValuations ?? []),
    diversificationScore: computeDiversificationScore(positions),
    concentrationRisk: computeConcentrationRisk(positions),
  };
}

/**
 * Realized portfolio volatility — weighted sum of position volatilities
 * adjusted for cross-correlations (simplified).
 */
function computeRealizedVolatility(
  positions: PositionForMetrics[],
  historicalReturns: Map<string, number[]>,
): number {
  if (positions.length === 0) return 0;

  // Simple weighted volatility (ignores correlation for speed)
  // A more accurate version would use the full covariance matrix
  let weightedVarSum = 0;

  for (const pos of positions) {
    const returns = historicalReturns.get(pos.ticker);
    const vol = returns && returns.length >= 20
      ? annualizedVol(returns)
      : 0.25; // default
    const w = pos.weightPct / 100;
    weightedVarSum += w * w * vol * vol;
  }

  // Add a cross-term approximation (assume avg correlation of 0.3)
  const avgCorr = 0.3;
  for (let i = 0; i < positions.length; i++) {
    const pi = positions[i]!;
    const volI = getVol(pi.ticker, historicalReturns);
    for (let j = i + 1; j < positions.length; j++) {
      const pj = positions[j]!;
      const volJ = getVol(pj.ticker, historicalReturns);
      weightedVarSum += 2 * (pi.weightPct / 100) * (pj.weightPct / 100) * avgCorr * volI * volJ;
    }
  }

  return Math.sqrt(Math.max(0, weightedVarSum));
}

function getVol(ticker: string, historicalReturns: Map<string, number[]>): number {
  const returns = historicalReturns.get(ticker);
  return returns && returns.length >= 20 ? annualizedVol(returns) : 0.25;
}

function annualizedVol(returns: number[]): number {
  if (returns.length < 2) return 0.25;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

/**
 * Simple max drawdown from portfolio valuation history.
 */
function computeMaxDrawdown(
  valuations: { date: string; totalValue: number }[],
): number {
  if (valuations.length < 2) return 0;

  let peak = valuations[0]!.totalValue;
  let maxDD = 0;

  for (const v of valuations) {
    if (v.totalValue > peak) peak = v.totalValue;
    const dd = peak > 0 ? (peak - v.totalValue) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return maxDD;
}

/**
 * Concentration risk based on Herfindahl-Hirschman Index (HHI).
 * Higher value = more concentrated.
 */
function computeConcentrationRisk(positions: PositionForMetrics[]): number {
  const activePositions = positions.filter((p) => p.weightPct > 0.1);
  if (activePositions.length === 0) return 0;

  let hhi = 0;
  for (const p of activePositions) {
    const w = p.weightPct / 100;
    hhi += w * w;
  }

  // Normalize: min HHI = 1/n, max = 1
  const minHhi = 1 / activePositions.length;
  if (hhi <= minHhi) return 0;
  return Math.min(1, (hhi - minHhi) / (1 - minHhi));
}

/**
 * Diversification score — inverse of concentration risk.
 */
function computeDiversificationScore(positions: PositionForMetrics[]): number {
  return 1 - computeConcentrationRisk(positions);
}
