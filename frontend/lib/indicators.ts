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
