# Version 0.72 — All-Asset Score Outcomes & Safer Calibration

## Architecture Summary

Adds a broader calibration source (`score_outcomes`) that tracks forward returns for every scored asset/day — not just the few assets that happened to be recommended in live portfolios. This eliminates small-sample bias and gives calibration a much wider evidence base.

## What Was Built

### 1. Schema: `score_outcomes` table (Migration 027)
New table tracking forward returns for all 100 scored tickers on every scoring date.
- Fields: ticker, score_date, asset_type, composite_score, confidence, data_freshness, score_bucket, confidence_bucket, prices at score/1d/7d/30d, returns, benchmark returns, beat_benchmark flags
- Unique constraint on `(ticker, score_date)` for idempotent upserts

### 2. New mode: `--score-outcomes`
Added to `backend/jobs/evaluate-optimizer.ts`.

How it works:
1. Finds all dates with full pipeline runs (≥10 technical scores)
2. Skips dates already fully evaluated
3. For each date, loads true composite scores for all tickers (using `loadScoresForDate` — same blending as production optimizer)
4. Looks up forward prices at 1d/7d/30d and SPY benchmark
5. Upserts to `score_outcomes` in batches of 50
6. Idempotent — safe to run repeatedly; skips completed dates

### 3. Calibration now uses `score_outcomes` (not `recommendation_outcomes`)
The `--calibrate` mode now reads from `score_outcomes` (up to 50,000 rows) instead of `recommendation_outcomes`. This provides:
- ~100 samples per scoring date (all tickers) vs ~5-10 (just recommendations)
- Unbiased coverage across all score buckets
- Much faster convergence to meaningful calibration

`recommendation_outcomes` remains intact and separate for evaluating live portfolio decisions.

### 4. Safety Gating
Calibrated expected returns are only produced when a score bucket has ≥20 samples (`MIN_CALIBRATION_SAMPLES`).

Gating enforced in three places:
1. **Calibration writer** (`--calibrate`): writes `calibrated_expected_return = null` for under-threshold buckets
2. **Synthesis loader** (`backend/jobs/synthesis.ts`): only loads calibration rows where `sample_count >= 20`
3. **Build route loader** (`frontend/app/api/optimizer/build/route.ts`): same threshold check

When calibration is absent or below threshold, the optimizer falls back to its heuristic expected-return mapping automatically.

## Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p backend/tsconfig.json` | 1 pre-existing error in `conclusion-generation.ts:64` (unrelated) |
| `npx tsc --noEmit -p agents/tsconfig.json` | PASS (0 errors) |

## Files Changed

**New files:**
- `db/migrations/027_create_score_outcomes.sql`
- `docs/changelogs/summary_version_072.md`

**Modified files:**
- `backend/jobs/evaluate-optimizer.ts` — added `--score-outcomes` mode, refactored `--calibrate` to use `score_outcomes`, added `MIN_CALIBRATION_SAMPLES` gating
- `backend/jobs/synthesis.ts` — added sample-count gate to calibration loader
- `frontend/app/api/optimizer/build/route.ts` — added sample-count gate to calibration loader
- `frontend/app/(auth)/login/page.tsx` — version 0.72
- `frontend/app/dashboard/page.tsx` — version 0.72
- `frontend/app/market/page.tsx` — version 0.72

## Recommended Usage

```bash
# Weekly: generate score outcomes for all historical scoring dates
npx tsx backend/jobs/evaluate-optimizer.ts --score-outcomes

# Weekly: score live recommendation outcomes
npx tsx backend/jobs/evaluate-optimizer.ts --outcomes

# After enough score outcomes accumulate (≥20 per bucket):
npx tsx backend/jobs/evaluate-optimizer.ts --calibrate

# One-off: backtest over a date range
npx tsx backend/jobs/evaluate-optimizer.ts --backtest --from 2026-01-01 --to 2026-03-15
```

## Residual Risks / Next Steps

1. Migration 027 must be run in Supabase SQL Editor before `--score-outcomes` can persist data
2. First `--score-outcomes` run will be slow (one price lookup per ticker per date per horizon); subsequent runs are fast (skips completed dates)
3. Consider scheduling `--score-outcomes` + `--calibrate` as a weekly GitHub Action
4. The `backend/optimizer/` directory (9 files from v0.6) remains dead code
