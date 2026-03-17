# Version 0.73 — Covariance-Aware Portfolio Optimization

## Architecture Summary

Upgrades the optimizer from heuristic score-proportional allocation to covariance-aware portfolio optimization. The optimizer now uses real pairwise correlations from historical returns, iterative objective maximization, theme/cluster concentration controls, and trade-friction-aware rebalancing.

## What Changed

### 1. Real Covariance/Correlation Model
**Before:** Fixed average correlation of 0.30 for all pairs.
**After:** Pairwise correlations computed from overlapping daily log returns in `price_history`. Applied with Ledoit-Wolf-style shrinkage (30% blend toward defaults to reduce estimation noise). Asset-type-aware defaults when pair data is missing (crypto pairs: 0.65, cross-type: 0.15, equity: 0.30).

### 2. Iterative Objective-Based Allocation
**Before:** Score-proportional weights with basic clipping.
**After:** Iterative greedy solver maximizing:
```
E[return] - λ_risk × portfolio_variance - λ_conc × HHI
           - λ_cluster × cluster_overweight² - λ_turnover × turnover
           - friction × trade_count
```
Where λ values are derived from user risk profile and volatility tolerance. The solver iterates up to 60 rounds of pairwise weight shifts, accepting only improvements that pass all hard constraints.

### 3. Theme/Cluster Concentration Controls
Nine theme clusters defined (mega_tech, semiconductors, fintech, ev_mobility, china_tech, crypto_major, crypto_alt, broad_equity_etf, bond_commodity_etf). Maximum 45% allocation per cluster. Cluster overweight is penalized quadratically in the objective function.

### 4. Trade-Friction-Aware Rebalancing
- Minimum trade threshold: wider of rebalance band (1.5-3%) and min trade size (1%)
- Per-trade friction proxy (~10bps) counted in objective function
- Turnover penalty of ~50bps per unit of turnover
- Existing positions biased 25% toward current weights (turnover damping)

### 5. Richer Risk Summary
New fields in `OptimizerRiskSummary`:
- `avgPairwiseCorrelation`: weighted average correlation in portfolio
- `tickersWithVolData`: count of positions with real historical vol data
- Max drawdown estimate upgraded to Cornish-Fisher approximation (2.33×vol for 99% annual)

### 6. Action Rationale
`OptimizerPortfolioAction` now includes optional `rationale` field with portfolio-level reasoning (e.g., "Reducing to manage portfolio volatility (ticker vol 42%)").

### 7. CovarianceData Interface
New `CovarianceData` type exported from optimizer core:
```typescript
interface CovarianceData {
  volatilities: Map<string, number>;
  correlations: Map<string, number>; // key = "AAPL|MSFT" (sorted)
}
```
Callers can pass either `Map<string, number>` (backward compat, vols only) or full `CovarianceData`.

## Files Changed

- `shared/lib/optimizer-core.ts` — complete rewrite: covariance model, iterative solver, cluster controls, friction awareness, richer risk summary
- `frontend/app/api/optimizer/build/route.ts` — `loadCovarianceData()` replaces `loadTickerVolatilities()`, computes pairwise correlations
- `backend/jobs/synthesis.ts` — `loadCovarianceData()` replaces `loadTickerVolatilities()`, passes `CovarianceData` to optimizer
- `frontend/next.config.js` — (unchanged, extensionAlias still needed)
- Version labels bumped to 0.73 in login, dashboard, market pages

## Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit -p frontend/tsconfig.json` | PASS (0 errors) |
| `npx tsc --noEmit -p backend/tsconfig.json` | 1 pre-existing error in `conclusion-generation.ts:64` (unrelated) |
| `npx tsc --noEmit -p agents/tsconfig.json` | PASS (0 errors) |

## Residual Risks / Next Steps

1. **Pairwise correlation computation is bounded to 30 tickers** in synthesis to keep daily job fast. Consider caching or precomputing.
2. **Cluster definitions are static** — could be derived from `assets.sector` field if that data is populated.
3. **The iterative solver is greedy** — guaranteed to converge but not globally optimal. For 8-position portfolios this is fine; would need QP for larger universes.
4. **Backtest evaluator** still passes `new Map()` for covariance data — would benefit from loading historical data for more realistic backtests.
5. The `backend/optimizer/` directory (9 files from v0.6) is dead code and should be removed.
