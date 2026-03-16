# Version 0.61 — Optimizer Hardening

## Hardening Summary

### 1. Optimizer Drift Eliminated

**Before:** Three independent optimizer implementations:
- `backend/optimizer/solve.ts` (full iterative QP-like solver — never used by daily or onboarding)
- `frontend/app/api/optimizer/build/route.ts` (inline ~150-line simplified optimizer)
- `backend/jobs/synthesis.ts` (inline ~150-line simplified optimizer, slightly different from build)

**After:** One shared optimizer core:
- `shared/lib/optimizer-core.ts` — single `runOptimizerCore()` function
- `frontend/app/api/optimizer/build/route.ts` — imports and calls `runOptimizerCore()`
- `backend/jobs/synthesis.ts` — imports and calls `runOptimizerCore()`

All allocation logic, constraint enforcement, action generation, and risk computation happen in one place. Tuning behavior in `optimizer-core.ts` affects both onboarding and daily management identically.

### 2. Placeholders Replaced

| Placeholder | Before | After |
|---|---|---|
| `portfolioVolatility: 0` in build route | Hardcoded 0 | Real weighted-vol with cross-correlation approximation from `price_history` |
| `goal_probability_pct: 50` in finalize | Hardcoded 50 | `computeGoalProbabilityHeuristic()` using expected return, goal return, vol, diversification, time horizon |

The goal probability heuristic is explicitly marked as "v1 — temporary, pragmatic" in the code. It's a sigmoid-based model, not the full AI probability estimator.

### 3. Risk Metrics Wired

- `computeRiskSummary()` in `optimizer-core.ts` computes volatility, concentration, diversification, max-DD estimate, crypto allocation
- Build route now loads `tickerVolatilities` from `price_history` before running optimizer
- Synthesis job persists `portfolio_risk_metrics` via upsert on every daily run
- Onboarding passes `riskSummary` from build response through to finalize for probability computation

### 4. Action Semantics Validated

Action generation in `optimizer-core.ts` correctly implements:
- `BUY`: current < 0.5%, target > 0.5%
- `SELL`: target < 0.5%, current > 0.5%
- `ADD`: delta > rebalance band (1.5–3% depending on risk profile)
- `REDUCE`: delta < -rebalance band
- `HOLD`: within band, with trivial holds (<0.1% delta) filtered out
- `MAX_DAILY_CHANGES` enforced (top 5 by priority kept, rest forced to HOLD)

### 5. Finalization Path Validated

- Portfolio created only once (checks for existing active portfolio first)
- Existing positions cleared on re-finalization (safe for onboarding retry)
- Unique constraint race condition handled (23505 code)
- Cash balance computed correctly from `capital - investedValue`
- Valuation uses computed probability heuristic instead of hardcoded 50

### 6. Synthesis Explanation-Only Confirmed

- `runOptimizerCore()` determines all target weights and actions
- LLM called only for narrative explanation
- If LLM fails, recommendations persist from optimizer output with fallback narrative
- Logging clearly shows `llm=false (optimizer-only)` vs `llm=true`

### 7. Finnhub/News Fix

Added detection for Finnhub's HTTP-200 error body pattern (`{"error": "Invalid API key"}`), which previously would silently return 0 articles. Now throws `FinnhubAuthError` and aborts the job.

### 8. Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p agents/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p backend/tsconfig.json` | 1 pre-existing error in `conclusion-generation.ts:64` (unrelated) |

### 9. Files Changed

**New files:**
- `shared/lib/optimizer-core.ts` — single shared optimizer engine with goal probability heuristic

**Modified files:**
- `frontend/app/api/optimizer/build/route.ts` — replaced inline optimizer with shared core import + added volatility loading
- `frontend/app/api/optimizer/finalize/route.ts` — replaced hardcoded goal_probability_pct:50 with heuristic, accepts riskSummary
- `frontend/app/onboarding/page.tsx` — passes riskSummary through to finalize
- `backend/jobs/synthesis.ts` — replaced inline optimizer with shared core import + persists portfolio_risk_metrics
- `backend/jobs/news.ts` — detect Finnhub HTTP-200 error bodies (invalid API key)
- `frontend/app/(auth)/login/page.tsx` — version bump to 0.61
- `frontend/app/dashboard/page.tsx` — version bump to 0.61
- `frontend/app/market/page.tsx` — version bump to 0.61

### 10. Residual Risks

1. The `backend/optimizer/` directory (9 files) is now dead code — it was never imported by the build route or synthesis job. Consider removing it or keeping it as a reference implementation.
2. Goal probability heuristic is a temporary sigmoid model. The full AI probability model should replace it.
3. Cross-correlation approximation uses fixed `avgCorr=0.3`. Actual pairwise correlations from covariance matrix would be more accurate.
4. No E2E integration tests — requires live Supabase connection to validate the full onboarding → dashboard → daily management cycle.
