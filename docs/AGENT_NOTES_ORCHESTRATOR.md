# Orchestrator Agent Notes

## Status

**Complete.** All scaffold files are created. The four parallel agents may begin.

---

## Install Command

Run this once at the repo root before starting any agent:

```bash
npm install
```

---

## Files Created

### Root
| File | Purpose |
|---|---|
| `package.json` | npm workspace root; workspaces: frontend, backend |
| `tsconfig.json` | Base TypeScript config (strict mode, ES2022, NodeNext) |
| `.env.example` | All env vars documented with comments |
| `.gitignore` | node_modules, .env, .next, dist, build |
| `README.md` | Project overview, how to run, agent ownership map |
| `AGENT_NOTES_ORCHESTRATOR.md` | This file |

### Directories with .gitkeep (empty, agent-owned)
- `db/migrations/`
- `db/seeds/`
- `db/rls/`
- `backend/pipeline/ingestion/`
- `backend/pipeline/providers/`
- `backend/pipeline/scheduler/`
- `agents/technical/`
- `agents/sentiment/`
- `agents/fundamental/`
- `agents/regime/`
- `agents/synthesis/`
- `frontend/components/`
- `frontend/lib/`

### Shared Types (`/shared/types/`)

All agents import from these files. **Do not rename or remove existing exports.**

#### `assets.ts`
```typescript
export type AssetType = 'stock' | 'etf' | 'crypto'
export interface Asset { ticker, name, assetType, sector, active }
export interface PriceHistory { ticker, date, open, high, low, close, volume }
export interface NewsItem { id, ticker, headline, summary, source, publishedAt, url }
export interface FundamentalData { ticker, date, peRatio, psRatio, revenueGrowthYoy, profitMargin, roe, marketCap, debtToEquity }
export interface MacroEvent { id, date, eventDescription, eventType, relevantAssetTypes, relevantTickers, sentiment, sourceUrl }
```

#### `scores.ts`
```typescript
export type AgentType = 'technical' | 'sentiment' | 'fundamental' | 'market_regime'
export type DataFreshness = 'current' | 'stale' | 'missing'
export interface AgentScore { ticker, date, agentType, score, confidence, componentScores, explanation, dataFreshness, agentVersion }
```

#### `portfolio.ts`
```typescript
export type RiskProfile = 'conservative' | 'balanced' | 'aggressive'
export type VolatilityTolerance = 'moderate' | 'balanced' | 'tolerant'
export type GoalStatus = 'on_track' | 'monitor' | 'at_risk' | 'off_track'
export interface UserProfile { userId, investmentCapital, timeHorizonMonths, riskProfile, goalReturnPct, maxDrawdownLimitPct, volatilityTolerance, assetTypes, maxPositions }
export interface Portfolio { id, userId, name, createdAt, status }
export interface PortfolioPosition { id, portfolioId, ticker, quantity, avgPurchasePrice, openedAt }
export interface PortfolioValuation { portfolioId, date, totalValue, cashValue, dailyPnl, cumulativeReturnPct, goalProbabilityPct }
export interface PortfolioRiskMetrics { portfolioId, date, volatility, maxDrawdownPct, diversificationScore, concentrationRisk }
```

#### `synthesis.ts`
```typescript
export type MarketRegimeLabel = 'bullish' | 'neutral' | 'cautious' | 'bearish'
export type RecommendationAction = 'BUY' | 'SELL' | 'REDUCE' | 'ADD' | 'HOLD'
export type RecommendationUrgency = 'high' | 'medium' | 'low'
export interface PortfolioPositionContext { ticker, currentAllocationPct, currentValue, unrealizedPnlPct }
export interface AssetScoreContext { ticker, technicalScore, sentimentScore, fundamentalScore, regimeScore, technicalConfidence, sentimentConfidence, fundamentalConfidence, regimeConfidence, dataFreshness }
export interface MacroEventContext { date, eventDescription, eventType, sentiment, relevantAssetTypes }
export interface SynthesisContextPackage { userContext, portfolioState, assetScores, marketRegime, macroEvents }
export interface SynthesisRecommendation { ticker, action, urgency, targetAllocationPct, reasoning, confidence }
export interface SynthesisOutput { weightRationale, portfolioAssessment, recommendations, portfolioNarrative, overallConfidence, lowConfidenceReasons }
```

#### `recommendations.ts`
```typescript
export interface RecommendationRun { id, portfolioId, runDate, synthesisRunId, overallConfidence, goalStatus, portfolioNarrative, weightRationale, generatedAt }
export interface RecommendationItem { id, runId, ticker, action, urgency, currentAllocationPct, targetAllocationPct, llmReasoning, confidence, rulesEngineApplied, rulesEngineNote, priority }
export type UserDecisionValue = 'approved' | 'dismissed' | 'deferred'
export interface UserDecision { id, recommendationId, decision, decidedAt, userNote }
```

### Shared Lib (`/shared/lib/`)

#### `supabase.ts`
```typescript
export function createSupabaseClient(): SupabaseClient      // server-side, service role
export function createSupabaseBrowserClient(): SupabaseClient // client-side, anon key
```

#### `constants.ts`
```typescript
export const STOCKS: readonly string[]        // 63 stock tickers
export const ETFS: readonly string[]          // 20 ETF tickers
export const CRYPTO: readonly string[]        // 20 crypto tickers
export const ASSET_UNIVERSE: readonly string[] // all 100 tickers
export const ASSET_TYPE_MAP: Record<string, AssetType>
export const SCORE_THRESHOLDS: { STRONG_BUY_MIN, BUY_MIN, HOLD_MIN, SELL_MIN, STRONG_SELL_MIN }
export function scoreToSignal(score: number): 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell'
export const DEFAULT_AGENT_WEIGHTS: { technical: 0.50, sentiment: 0.25, fundamental: 0.20, regime: 0.05 }
export const SENTIMENT_DECAY_FACTOR: 0.9
export const MAX_POSITIONS_DEFAULT: 10
export const SYNTHESIS_MODEL: 'claude-opus-4-6'   // ← changed from brief default per user request
export const MAX_POSITION_PCT: 0.30
export const MAX_CRYPTO_ALLOCATION_PCT: 0.40
export const CASH_FLOOR_PCT: 0.05
export const MAX_DAILY_CHANGES: 5
```

### Frontend (`/frontend/`)
| File | Purpose |
|---|---|
| `package.json` | Next.js 14, React 18, Supabase, Tailwind, Recharts, Lucide |
| `next.config.js` | Minimal config with env var passthrough |
| `tailwind.config.js` | Content paths for app/, components/, lib/ |
| `tsconfig.json` | Extends root tsconfig; moduleResolution: bundler; JSX: preserve |
| `app/globals.css` | Tailwind base/components/utilities imports |
| `app/layout.tsx` | Root layout — html/body with Tailwind dark background |
| `app/page.tsx` | Placeholder: "Portfolio Advisor — Loading" |

### Backend (`/backend/`)
| File | Purpose |
|---|---|
| `package.json` | Supabase, Anthropic SDK, Zod, node-cron, axios, dotenv |

---

## Assumptions Made

1. **Model changed**: `SYNTHESIS_MODEL` is set to `'claude-opus-4-6'` (user request) instead of `'claude-sonnet-4-20250514'` as written in the brief.
2. **STOCKS count**: The brief lists 63 stock tickers (not 60). All 63 included; ASSET_UNIVERSE has 103 assets total. This is correct per the brief's explicit list.
3. **Module resolution**: Root `tsconfig.json` uses `NodeNext`; frontend `tsconfig.json` overrides to `bundler` for Next.js compatibility.
4. **`docs/` directory**: The spec .docx files are in the project root (not `/docs/`). No `/docs/` directory created to avoid moving files.
5. **`shared/` types use `.js` extensions** in import paths to satisfy NodeNext module resolution at runtime.
6. **Portfolio.status** typed as `'active' | 'archived'` — not specified in brief, but needed for a valid interface.
7. **UserDecisionValue** typed as `'approved' | 'dismissed' | 'deferred'` — reasonable values from product spec.

---

## What Each Agent Needs Next

| Agent | First action |
|---|---|
| **Database Agent** | Read `brief_1_database.md`, then `shared/types/` — write migrations to `db/migrations/` matching the Supabase table names in CLAUDE.md |
| **Pipeline Agent** | Read `brief_2_pipeline.md` — write ingestion scripts to `backend/pipeline/` reading from Twelve Data + Finnhub |
| **Analysis Agent** | Read `brief_3_analysis.md` — write scoring agents to `agents/` reading from DB, writing to `agent_scores` |
| **Frontend Agent** | Read `brief_4_frontend.md` — build UI in `frontend/app/` and `frontend/components/` using the placeholder shell |
