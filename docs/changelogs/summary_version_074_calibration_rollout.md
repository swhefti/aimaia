# Version 0.74 — Safe Calibration Rollout Controls

## Summary

Adds explicit rollout safety controls so calibrated expected-return data only influences the live optimizer when evidence is strong enough. Calibration data continues to be collected and stored regardless, but only live-eligible rows affect portfolio construction.

## Design

### Eligibility Rules (in `shared/lib/calibration-config.ts`)
1. **Global kill switch**: `CALIBRATION_LIVE_ENABLED` — set to `false` to instantly revert all portfolios to heuristic-only
2. **Minimum samples**: ≥20 total samples per score bucket (`MIN_CALIBRATION_SAMPLES`)
3. **30d preference**: If ≥10 samples have 30d forward returns, full calibration weight (0.7). If 7d-only, reduced weight (0.4) to account for noisier short-horizon data
4. **Staleness**: Calibration older than 30 days is marked ineligible (`MAX_CALIBRATION_AGE_DAYS`)
5. **Non-null check**: Bucket must have a computed `calibrated_expected_return`

### Three-Layer Safety
1. **Calibration writer** (`--calibrate`): Computes `is_live_eligible` and `eligibility_reason` for each bucket, persists to DB
2. **Synthesis loader**: Only loads rows where `is_live_eligible = true`; respects global kill switch
3. **Build route loader**: Same check; respects global kill switch

### Schema Extension (Migration 029)
Added to `score_calibration`:
- `sample_count_7d` — count of 7d-return samples
- `sample_count_30d` — count of 30d-return samples
- `is_live_eligible` — boolean, computed by calibration job
- `eligibility_reason` — human-readable explanation
- `calibration_source` — tracks data source (score_outcomes)
- `updated_at` — timestamp for staleness checking

## Diagnostics

The `--calibrate` job now prints a rollout status table:
```
========== CALIBRATION ROLLOUT STATUS ==========
Score Bucket     | N    | N_7d | N_30d| Cal. E[R]  | Live? | Reason
-----------------|------|------|------|------------|-------|-------------------------------
strong_buy       | 45   | 45   | 12   | 8.50%      | YES   | OK: 45 samples (12 with 30d)
buy              | 120  | 120  | 35   | 3.20%      | YES   | OK: 120 samples (35 with 30d)
hold             | 200  | 200  | 0    | -0.10%     | YES   | OK (7d-only): 200 samples...
sell             | 15   | 15   | 0    | heuristic  | NO    | Sample count 15 < 20 minimum
strong_sell      | 5    | 5    | 0    | heuristic  | NO    | Sample count 5 < 20 minimum
=================================================
```

## Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p backend/tsconfig.json` | 1 pre-existing error in `conclusion-generation.ts:64` (unrelated) |
| `npx tsc --noEmit -p agents/tsconfig.json` | PASS (0 errors) |

## Files Changed

**New files:**
- `shared/lib/calibration-config.ts` — single source of truth for all calibration thresholds and eligibility rules
- `db/migrations/029_extend_score_calibration.sql` — adds eligibility metadata columns

**Modified files:**
- `backend/jobs/evaluate-optimizer.ts` — `--calibrate` now computes and persists eligibility; uses shared config; rich diagnostics
- `backend/jobs/synthesis.ts` — loadCalibration checks `is_live_eligible` and global kill switch
- `frontend/app/api/optimizer/build/route.ts` — same eligibility and kill-switch checks

## Operational Policy

1. Run migration 029 in Supabase SQL Editor
2. Run `--score-outcomes` to populate forward returns
3. Run `--calibrate` to compute calibration with eligibility flags
4. Inspect the rollout status table in job output
5. When satisfied, calibration is automatically used for eligible buckets
6. To disable instantly: set `CALIBRATION_LIVE_ENABLED = false` in `shared/lib/calibration-config.ts` and redeploy
