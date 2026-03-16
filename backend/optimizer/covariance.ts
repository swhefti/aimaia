/**
 * Covariance Estimation — rolling covariance with shrinkage fallback.
 *
 * Uses daily log returns to estimate a covariance matrix.
 * Applies simple Ledoit-Wolf-style shrinkage toward a diagonal target.
 */

const MIN_OBSERVATIONS = 20;
const SHRINKAGE_INTENSITY = 0.3; // blend factor toward diagonal
const DEFAULT_ANNUAL_VOL = 0.25; // fallback when data is sparse

/**
 * Compute annualized covariance matrix from daily log returns.
 * Returns a Map<"tickerA|tickerB", covariance> for the lower triangle + diagonal.
 * Tickers are sorted lexicographically for consistent keys.
 */
export function computeCovarianceMatrix(
  tickers: string[],
  historicalReturns: Map<string, number[]>,
): { matrix: Map<string, number>; volatilities: Map<string, number> } {
  const n = tickers.length;
  const matrix = new Map<string, number>();
  const volatilities = new Map<string, number>();

  // Compute raw sample covariance
  for (let i = 0; i < n; i++) {
    const ti = tickers[i]!;
    const ri = historicalReturns.get(ti) ?? [];

    // Compute volatility for ticker i
    const volI = ri.length >= MIN_OBSERVATIONS
      ? annualizedVol(ri)
      : DEFAULT_ANNUAL_VOL;
    volatilities.set(ti, volI);

    for (let j = i; j < n; j++) {
      const tj = tickers[j]!;
      const rj = historicalReturns.get(tj) ?? [];

      if (i === j) {
        // Diagonal: variance
        const variance = volI * volI;
        matrix.set(covKey(ti, tj), variance);
      } else {
        // Off-diagonal: covariance
        const rawCov = sampleCovariance(ri, rj);
        // Shrinkage: blend raw covariance with zero (diagonal target has 0 off-diag)
        const shrunk = rawCov * (1 - SHRINKAGE_INTENSITY);
        matrix.set(covKey(ti, tj), shrunk);
        matrix.set(covKey(tj, ti), shrunk); // symmetric
      }
    }
  }

  return { matrix, volatilities };
}

function annualizedVol(returns: number[]): number {
  if (returns.length < 2) return DEFAULT_ANNUAL_VOL;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

function sampleCovariance(ra: number[], rb: number[]): number {
  const n = Math.min(ra.length, rb.length);
  if (n < MIN_OBSERVATIONS) return 0;

  // Use the last n observations
  const a = ra.slice(-n);
  const b = rb.slice(-n);

  const meanA = a.reduce((s, v) => s + v, 0) / n;
  const meanB = b.reduce((s, v) => s + v, 0) / n;

  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i]! - meanA) * (b[i]! - meanB);
  }
  // Annualize
  return (cov / (n - 1)) * 252;
}

export function covKey(a: string, b: string): string {
  return `${a}|${b}`;
}

/**
 * Compute portfolio variance given weights and covariance matrix.
 * weights: Map<ticker, weight (0-1)>
 */
export function portfolioVariance(
  tickers: string[],
  weights: Map<string, number>,
  covMatrix: Map<string, number>,
): number {
  let variance = 0;
  for (const ti of tickers) {
    const wi = weights.get(ti) ?? 0;
    for (const tj of tickers) {
      const wj = weights.get(tj) ?? 0;
      const cov = covMatrix.get(covKey(ti, tj)) ?? 0;
      variance += wi * wj * cov;
    }
  }
  return variance;
}
