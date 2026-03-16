# Version 0.7 — Optimizer Evaluation & Calibration

## Evaluation Architecture Summary

This version adds an evaluation and calibration layer to measure whether the optimizer actually improves outcomes and to data-back the expected-return mapping.

### What was built

1. **Evaluation schema** (`db/migrations/026_create_recommendation_outcomes.sql`)
   - `recommendation_outcomes` — per-recommendation forward-return tracking at 1d/7d/30d with benchmark comparison
   - `optimizer_backtest_runs` — walk-forward simulation results (cumulative return, drawdown, Sharpe, hit rates)
   - `score_calibration` — aggregated score-bucket → calibrated expected return mapping

2. **Evaluation job** (`backend/jobs/evaluate-optimizer.ts`)
   Three modes:
   - `--outcomes`: Scores recent recommendation items against realized forward returns from `price_history`. Measures 1d/7d/30d returns, compares against SPY benchmark, segments by action type, score bucket, and confidence bucket.
   - `--backtest`: Walk-forward simulation over a configurable date range. Reconstructs optimizer decisions from historical `agent_scores`, executes simulated trades, reports cumulative return, max drawdown, realized volatility, Sharpe ratio, turnover, and recommendation hit rates vs SPY.
   - `--calibrate`: Aggregates outcome data by score bucket, computes observed forward returns, and derives a calibrated expected-return mapping. Blends 70% observed data with 30% original heuristic (safe fallback when data is sparse). Persists to `score_calibration` table.

3. **Calibrated expected-return mapping** (`shared/lib/optimizer-core.ts`)
   - New `CalibrationMap` type exported from optimizer core
   - `computeExpectedReturn()` now accepts optional calibration data
   - When calibration data is available, blends 60% calibrated + 40% heuristic (with confidence/freshness damping applied to both)
   - Falls back to pure heuristic when no calibration data exists
   - `runOptimizerCore()` accepts optional `CalibrationMap` parameter

4. **Calibration wired into production paths**
   - `backend/jobs/synthesis.ts` loads calibration from `score_calibration` table on startup, passes to every `runOptimizerCore()` call
   - `frontend/app/api/optimizer/build/route.ts` loads calibration before running optimizer for onboarding

5. **Next.js webpack fix** (`frontend/next.config.js`)
   - Added `resolve.extensionAlias` so `.js` imports in `shared/` resolve to `.ts` files
   - This allows shared modules to use `.js` extensions (required by backend NodeNext) while still working in the Next.js webpack build

### Schema Changes

**New tables (Migration 026):**
- `recommendation_outcomes` — forward return tracking per recommendation
- `optimizer_backtest_runs` — backtest run summaries
- `score_calibration` — calibrated score→expected-return mapping

### New Jobs/Scripts

- `backend/jobs/evaluate-optimizer.ts` — three-mode evaluation runner
  ```
  npx tsx backend/jobs/evaluate-optimizer.ts --outcomes
  npx tsx backend/jobs/evaluate-optimizer.ts --backtest --from 2026-01-01 --to 2026-03-15
  npx tsx backend/jobs/evaluate-optimizer.ts --calibrate
  npx tsx backend/jobs/evaluate-optimizer.ts --all
  ```

### How Outcome Tracking Works

1. The `--outcomes` mode scans recent `recommendation_items`
2. For each unscored item, it looks up:
   - Price at decision time from `price_history`
   - Forward prices at +1d, +7d, +30d
   - SPY benchmark prices for the same windows
3. Computes forward returns and benchmark-relative performance
4. Persists to `recommendation_outcomes` with score/confidence bucketing
5. Idempotent — skips items that already have outcomes

### How Expected-Return Calibration Works

1. `--calibrate` loads all outcomes with 7d/30d forward returns
2. Groups by score bucket (strong_buy, buy, hold, sell, strong_sell)
3. Computes average and median forward returns per bucket
4. Annualizes observed returns (30d × 252/30)
5. Blends: 70% observed annualized + 30% original heuristic (requires ≥5 samples)
6. Persists to `score_calibration` table
7. The optimizer core (`computeExpectedReturn`) then blends: 60% calibrated + 40% heuristic
8. Confidence/freshness damping is applied to both calibrated and heuristic values

### Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p backend/tsconfig.json` | 1 pre-existing error in `conclusion-generation.ts:64` (unrelated) |
| `npx tsc --noEmit -p agents/tsconfig.json` | PASS (0 errors) |
| `npx next build` (frontend) | PASS — all routes compiled |

### Files Changed

**New files:**
- `db/migrations/026_create_recommendation_outcomes.sql`
- `backend/jobs/evaluate-optimizer.ts`
- `docs/changelogs/summary_version_07.md`

**Modified files:**
- `shared/lib/optimizer-core.ts` — added `CalibrationMap` type, calibration-aware `computeExpectedReturn()`, optional calibration param to `runOptimizerCore()`
- `backend/jobs/synthesis.ts` — loads calibration from DB, passes to optimizer
- `frontend/app/api/optimizer/build/route.ts` — loads calibration from DB, passes to optimizer
- `frontend/next.config.js` — added `extensionAlias` for `.js` → `.ts` resolution
- `frontend/app/(auth)/login/page.tsx` — version bump to 0.7
- `frontend/app/dashboard/page.tsx` — version bump to 0.7
- `frontend/app/market/page.tsx` — version bump to 0.7

### Recommended Next Steps

1. **Run `--outcomes` after a few days of live recommendations** to populate `recommendation_outcomes`
2. **Run `--calibrate` once outcomes are populated** to compute the first real calibration
3. **Run `--backtest`** over the available historical date range to get baseline metrics
4. **Compare pre/post calibration** by running backtest with and without calibration data
5. **Migration 026 must be run** in Supabase SQL Editor before the evaluation job can persist data
6. Consider scheduling `--outcomes` as a weekly GitHub Action to keep calibration fresh
7. The `backend/optimizer/` directory (9 files from v0.6) is still dead code — can be removed
