/**
 * Compute Exponential Moving Average from an array of values.
 * Returns an array of the same length with EMA values.
 * The first (period - 1) values use SMA as seed.
 */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0 || period <= 0) return [];
  if (period > values.length) return values.map(() => NaN);

  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length);

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i]!;
    result[i] = NaN; // Not enough data yet
  }
  result[period - 1] = sum / period;

  // EMA from period onward
  for (let i = period; i < values.length; i++) {
    result[i] = values[i]! * k + result[i - 1]! * (1 - k);
  }

  return result;
}

export interface BollingerBands {
  upper: number[];
  middle: number[];
  lower: number[];
}

/**
 * Compute Bollinger Bands (period-day EMA ± multiplier × rolling std deviation).
 * Returns arrays of the same length as input. Values before enough data are NaN.
 */
export function calculateBollingerBands(
  values: number[],
  period: number = 20,
  multiplier: number = 2,
): BollingerBands {
  const middle = calculateEMA(values, period);
  const upper: number[] = new Array(values.length);
  const lower: number[] = new Array(values.length);

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1 || Number.isNaN(middle[i]!)) {
      upper[i] = NaN;
      lower[i] = NaN;
      continue;
    }
    // Rolling std deviation over last `period` values
    const window = values.slice(Math.max(0, i - period + 1), i + 1);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length;
    const std = Math.sqrt(variance);
    upper[i] = middle[i]! + multiplier * std;
    lower[i] = middle[i]! - multiplier * std;
  }

  return { upper, middle, lower };
}
