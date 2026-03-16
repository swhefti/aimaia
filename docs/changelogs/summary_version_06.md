# Version 0.6 — Optimizer-First Portfolio Architecture

## Architecture Summary

### What changed

The MAIPA product now uses an **optimizer-first architecture** where a single shared optimizer determines target portfolio weights, and the LLM synthesis agent is demoted to explanation-only.

---

## 1. DB/Schema Changes

**`db/migrations/025_add_portfolio_strategy.sql`**
- Adds `strategy_mode` (`'pro'`, default) and `strategy_version` (`'1.0'`, default) to `portfolios` table
- Safe migration: existing rows get defaults automatically

---

## 2. New Optimizer Modules (`backend/optimizer/`)

| File | Purpose |
|---|---|
| `types.ts` | All optimizer interfaces (inputs, outputs, config) |
| `expected-returns.ts` | Maps composite scores → annualized expected returns with confidence shrinkage |
| `covariance.ts` | Rolling covariance matrix with Ledoit-Wolf-style shrinkage |
| `candidate-selection.ts` | Filters & ranks eligible tickers by user preferences + scores |
| `constraints.ts` | Hard constraint enforcement (position cap, cash floor, crypto cap, max positions) + config derivation from risk profile |
| `solve.ts` | Core optimizer: iterative greedy allocation maximizing expected return minus risk/concentration/turnover penalties |
| `actions.ts` | Deterministic action generation from target-vs-current weight deltas with rebalance bands |
| `risk-metrics.ts` | Minimal risk metrics: realized volatility, concentration risk, diversification score, max drawdown |
| `index.ts` | Public API + `runOptimizer()` convenience function |

---

## 3. How Onboarding Now Works

**Old flow:** Client-side `generateRecommendations()` → card-by-card approve/dismiss → portfolio created during flow

**New flow:**
1. User completes same questionnaire (capital, horizon, goal, risk, asset types, industries, positions)
2. Last step calls **`POST /api/optimizer/build`** (server-side) which:
   - Loads latest agent scores from DB
   - Computes composite scores per ticker
   - Runs optimizer to determine target weights
   - Returns proposed allocation table
3. User sees **full portfolio draft** (allocation table + risk summary + cash reserve)
4. User can remove a position and re-run optimizer
5. User clicks "Approve & Create Portfolio"
6. **`POST /api/optimizer/finalize`** atomically:
   - Upserts user profile
   - Creates portfolio (with `strategy_mode='pro'`)
   - Inserts positions
   - Sets cash balance
   - Inserts initial valuation
   - Marks onboarding complete

**Critical:** Portfolio is created only on finalization, not during the questionnaire.

---

## 4. How Daily Recommendation Generation Works

**Old flow:** LLM generates recommendations → rules engine adjusts → save

**New flow** (`backend/jobs/synthesis.ts`):
1. Load all agent scores (shared across portfolios)
2. For each active portfolio:
   - Load current positions + prices
   - Apply drawdown hard stop (force-sell breached positions)
   - Run optimizer → target weights
   - Generate deterministic actions (BUY/ADD/REDUCE/SELL/HOLD) from deltas
   - Respect rebalance bands (suppress tiny trades)
   - Limit daily changes to MAX_DAILY_CHANGES
3. Call LLM to **explain** the optimizer's actions (narrative + per-action reasoning)
4. Write `recommendation_runs` + `recommendation_items` from **optimizer output** (not LLM)
5. If LLM fails, recommendations still exist — only narrative degrades

---

## 5. How Synthesis Was Changed to Explanation-Only

The LLM no longer determines:
- Target allocations
- Which actions to take
- Position sizing

The LLM now produces:
- Daily briefing narrative (plain language)
- Per-action explanation text
- Goal status assessment
- Overall assessment

New explanation prompt takes optimizer actions + portfolio context and asks the LLM to explain "why these changes make sense" without overriding the optimizer.

---

## 6. Minimal Risk Metrics Implemented

- **Realized portfolio volatility** — weighted position volatilities with approximate cross-correlation
- **Concentration risk** — HHI-based, normalized by number of positions
- **Diversification score** — inverse of concentration risk
- **Max drawdown** — computed from portfolio valuation history
- **Rebalance bands** — risk-profile dependent (1.5%–3% absolute) to suppress tiny noisy trades
- **Minimum position threshold** — 2% minimum to avoid dust allocations

---

## 7. Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p agents/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p backend/tsconfig.json` | 1 pre-existing error in `conclusion-generation.ts:64` (unrelated) |

---

## 8. Files Changed

**New files (14):**
- `db/migrations/025_add_portfolio_strategy.sql`
- `backend/optimizer/` (9 files: types, expected-returns, covariance, candidate-selection, constraints, solve, actions, risk-metrics, index)
- `frontend/app/api/optimizer/build/route.ts`
- `frontend/app/api/optimizer/finalize/route.ts`

**Modified files (7):**
- `shared/types/portfolio.ts` — Added `StrategyMode`, `strategyMode`, `strategyVersion` to Portfolio
- `frontend/lib/queries.ts` — Updated `getPortfolio` mapper and `createPortfolio` for new fields
- `frontend/app/onboarding/page.tsx` — Complete rewrite: optimizer-backed draft flow replaces card-by-card flow
- `frontend/app/dashboard/page.tsx` — Added strategy fields to guest portfolio literal
- `frontend/app/settings/page.tsx` — Added strategy fields to guest portfolio literal
- `backend/jobs/synthesis.ts` — Complete rewrite: optimizer-first with LLM explanation-only
- `agents/synthesis/index.ts` — Updated docs; retained as library fallback
- `backend/tsconfig.json` — Added `optimizer/**/*` to includes

---

## 9. Residual Risks / Recommended Follow-ups

1. **Migration 025 must be run** in Supabase SQL Editor before deploying
2. **Optimizer is CPU-only** — no external solver library. Works well for 100-asset universe but won't scale to thousands
3. **Covariance estimation** uses simplified shrinkage. For production quality, consider Ledoit-Wolf exact or factor model
4. **Historical returns** for covariance are not yet loaded in the API route (placeholder `portfolioVolatility: 0`). The daily job loads them. Adding `price_history` loading to the build route would improve onboarding risk estimates
5. **Goal probability** is set to 50 on finalization. Should be computed properly after the first daily pipeline run
6. **The `agents/synthesis/` library version** still uses the old LLM-first flow. Only the production job (`backend/jobs/synthesis.ts`) uses the new optimizer-first flow. If the agents/ pipeline is ever invoked directly, consider migrating it too
7. **No E2E tests** — the system needs manual testing with a real Supabase instance to validate the full onboarding and daily management flows
