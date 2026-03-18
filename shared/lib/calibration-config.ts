/**
 * Calibration rollout configuration — single source of truth.
 *
 * Controls when calibrated expected returns are trusted for live optimizer use.
 * Imported by: synthesis, build route, evaluate-optimizer.
 */

/** Minimum total samples per score bucket to be considered for live use. */
export const MIN_CALIBRATION_SAMPLES = 20;

/** Minimum 30d-return samples preferred. If not met, 7d-only data is allowed
 *  but the calibration weight is reduced (see CALIBRATION_7D_ONLY_WEIGHT). */
export const PREFERRED_30D_SAMPLES = 10;

/** When calibration is backed by 7d data only (no 30d), reduce its influence. */
export const CALIBRATION_7D_ONLY_WEIGHT = 0.4; // vs 0.6 for 30d-backed

/** Maximum age (days) of a calibration row before it's considered stale. */
export const MAX_CALIBRATION_AGE_DAYS = 30;

/**
 * Global kill switch: if false, all live calibration is disabled regardless of
 * per-bucket eligibility. Set to false to instantly revert to heuristic-only.
 */
export const CALIBRATION_LIVE_ENABLED = true;

/**
 * Determine whether a calibration row is eligible for live optimizer use.
 * Returns { eligible, reason }.
 */
export function computeEligibility(params: {
  sampleCount: number;
  sampleCount7d: number;
  sampleCount30d: number;
  calibratedExpectedReturn: number | null;
  updatedAt: string | null;
  /** Override the compile-time kill switch with a DB-driven value. If omitted, uses CALIBRATION_LIVE_ENABLED. */
  liveEnabledOverride?: boolean | undefined;
}): { eligible: boolean; reason: string } {
  const liveEnabled = params.liveEnabledOverride ?? CALIBRATION_LIVE_ENABLED;
  if (!liveEnabled) {
    return { eligible: false, reason: 'Global calibration kill switch is OFF' };
  }

  if (params.calibratedExpectedReturn === null) {
    return { eligible: false, reason: 'No calibrated expected return computed' };
  }

  if (params.sampleCount < MIN_CALIBRATION_SAMPLES) {
    return { eligible: false, reason: `Sample count ${params.sampleCount} < ${MIN_CALIBRATION_SAMPLES} minimum` };
  }

  // Check staleness
  if (params.updatedAt) {
    const age = (Date.now() - new Date(params.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (age > MAX_CALIBRATION_AGE_DAYS) {
      return { eligible: false, reason: `Calibration is ${Math.round(age)}d old (max ${MAX_CALIBRATION_AGE_DAYS}d)` };
    }
  }

  // Eligible — note whether it's 30d-backed or 7d-only
  if (params.sampleCount30d >= PREFERRED_30D_SAMPLES) {
    return { eligible: true, reason: `OK: ${params.sampleCount} samples (${params.sampleCount30d} with 30d)` };
  }

  if (params.sampleCount7d >= MIN_CALIBRATION_SAMPLES) {
    return { eligible: true, reason: `OK (7d-only): ${params.sampleCount} samples, ${params.sampleCount30d} with 30d < ${PREFERRED_30D_SAMPLES} preferred` };
  }

  return { eligible: false, reason: `Insufficient 7d samples: ${params.sampleCount7d}` };
}
