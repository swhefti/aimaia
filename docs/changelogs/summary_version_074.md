# Version 0.74 — Portfolio Risk Model Upgrade & Dashboard Monitoring

## Summary

Upgrades the portfolio risk model with extended metrics, richer explanations, expanded DB persistence, and a new dashboard risk monitoring panel.

## What Changed

### 1. Extended Portfolio Risk Metrics
**New fields** in `PortfolioRiskMetrics` type and `portfolio_risk_metrics` table:
- `avgPairwiseCorrelation` — average pairwise correlation in portfolio
- `cryptoAllocationPct` — crypto allocation (0-100)
- `largestPositionPct` — largest single position weight (0-100)
- `tickersWithVolData` — count of positions with real historical vol data
- `portfolioExpectedReturn` — annualized expected return from optimizer

### 2. Risk Metrics Now Persisted with Full Detail
The daily synthesis job now writes all extended risk metrics to `portfolio_risk_metrics` — not just the four base fields. Migration 028 adds the new columns.

### 3. Dashboard Risk Monitoring Panel
New "Portfolio Risk" card in the right column of the dashboard showing:
- Portfolio volatility
- Diversification score
- Concentration risk
- Average pairwise correlation
- Max drawdown estimate
- Crypto allocation (if > 0)
- Largest position weight

Data loaded from `portfolio_risk_metrics` via new `getLatestRiskMetrics()` query.

### 4. Richer Action Rationale
The optimizer now generates more portfolio-level context in action rationale:
- `BUY`: mentions cluster exposure being added, vol-adjusted sizing
- `SELL`: explains portfolio risk/return improvement
- `REDUCE`: cites ticker vol, overweight position, crypto exposure management
- `ADD`: references score confidence and cluster allocation

### 5. Risk-Aware LLM Explanations
The synthesis explanation prompt now includes:
- Portfolio volatility
- Diversification score
- Average correlation
- Crypto allocation
- Instructions to reference portfolio-level risk in explanations

### 6. `largestPositionPct` Added to Risk Summary
Optimizer risk summary now tracks and reports the largest single position weight, used in concentration monitoring.

## Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p backend/tsconfig.json` | 1 pre-existing error in `conclusion-generation.ts:64` (unrelated) |
| `npx tsc --noEmit -p agents/tsconfig.json` | PASS (0 errors) |

## Files Changed

**New files:**
- `db/migrations/028_extend_portfolio_risk_metrics.sql`
- `docs/changelogs/summary_version_074.md`

**Modified files:**
- `shared/types/portfolio.ts` — extended `PortfolioRiskMetrics` with 5 new fields
- `shared/lib/optimizer-core.ts` — added `largestPositionPct` to risk summary, improved action rationale
- `backend/jobs/synthesis.ts` — extended risk metrics persistence, risk-aware explanation prompt
- `frontend/lib/queries.ts` — added `getLatestRiskMetrics()` query
- `frontend/app/dashboard/page.tsx` — added risk metrics state/loading + dashboard panel
- `backend/optimizer/risk-metrics.ts` — updated dead-code type to match new interface
- Version labels bumped to 0.74 in login, dashboard, market pages

## Residual Risks / Next Steps
1. Migration 028 must be run in Supabase SQL Editor
2. Risk metrics panel requires at least one daily synthesis run to populate data
3. The `backend/optimizer/` directory remains dead code and should be removed
4. Consider adding risk metric trend visualization (sparkline or small chart) in a future pass
