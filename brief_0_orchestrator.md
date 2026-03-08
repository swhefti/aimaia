# Agent Brief — Orchestrator (Phase 0)
# Run this agent FIRST and ALONE. All other agents depend on its output.

---

## Your Role

You are the Orchestrator. You run once, before any other agent starts.
Your job is to create the entire project scaffold that every other agent
will build inside. You write no business logic. You establish structure,
contracts, and conventions that make parallel development possible.

When you are done, four other agents will start simultaneously. They will
each own one part of the codebase. Your scaffold is what prevents them
from making incompatible assumptions.

---

## Documents to Read First

Before writing a single file, read these specs in full:

1. `/docs/Multi-Agent_System_Architecture_v2.docx`
2. `/docs/Data_Database_Architecture_v2.docx`
3. `/docs/LLM_Synthesis_Agent_Spec.docx`
4. `/docs/Product_Overview_User_Experience_v2.docx`

Then read `CLAUDE.md` in this directory.

---

## Your Tasks — In This Order

### Task 1 — Create the monorepo directory structure

Create every directory listed in CLAUDE.md. Include a `.gitkeep` in
empty directories so they exist in git. Create the top-level files:

- `package.json` (root workspace with npm workspaces for frontend and backend)
- `tsconfig.json` (base TypeScript config, strict mode on)
- `.env.example` (all env vars from CLAUDE.md documented with comments)
- `.gitignore` (node_modules, .env, .next, dist, build)
- `README.md` (project overview, how to run each part, agent ownership map)

### Task 2 — Write all shared TypeScript types

This is your most important task. Every other agent will import from
`/shared/types/`. Get these right — they are the contract between agents.

Create these files with complete, production-quality type definitions:

**`/shared/types/assets.ts`**
```
AssetType: 'stock' | 'etf' | 'crypto'
Asset: { ticker, name, assetType, sector, active }
PriceHistory: { ticker, date, open, high, low, close, volume }
NewsItem: { id, ticker, headline, summary, source, publishedAt, url }
FundamentalData: { ticker, date, peRatio, psRatio, revenueGrowthYoy, profitMargin, roe, marketCap, debtToEquity }
MacroEvent: { id, date, eventDescription, eventType, relevantAssetTypes, relevantTickers, sentiment, sourceUrl }
```

**`/shared/types/scores.ts`**
```
AgentType: 'technical' | 'sentiment' | 'fundamental' | 'market_regime'
DataFreshness: 'current' | 'stale' | 'missing'
AgentScore: { ticker, date, agentType, score, confidence, componentScores, explanation, dataFreshness, agentVersion }
```

**`/shared/types/portfolio.ts`**
```
RiskProfile: 'conservative' | 'balanced' | 'aggressive'
VolatilityTolerance: 'moderate' | 'balanced' | 'tolerant'
GoalStatus: 'on_track' | 'monitor' | 'at_risk' | 'off_track'
UserProfile: { userId, investmentCapital, timeHorizonMonths, riskProfile, goalReturnPct, maxDrawdownLimitPct, volatilityTolerance, assetTypes, maxPositions }
Portfolio: { id, userId, name, createdAt, status }
PortfolioPosition: { id, portfolioId, ticker, quantity, avgPurchasePrice, openedAt }
PortfolioValuation: { portfolioId, date, totalValue, cashValue, dailyPnl, cumulativeReturnPct, goalProbabilityPct }
PortfolioRiskMetrics: { portfolioId, date, volatility, maxDrawdownPct, diversificationScore, concentrationRisk }
```

**`/shared/types/synthesis.ts`**
```
MarketRegimeLabel: 'bullish' | 'neutral' | 'cautious' | 'bearish'
RecommendationAction: 'BUY' | 'SELL' | 'REDUCE' | 'ADD' | 'HOLD'
RecommendationUrgency: 'high' | 'medium' | 'low'

SynthesisContextPackage: {
  userContext: { goalReturnPct, timeHorizonMonths, riskProfile, maxDrawdownLimitPct, volatilityTolerance, assetTypePreference, maxPositions }
  portfolioState: { totalValueUsd, goalProbabilityPct, goalProbabilityTrend, cashAllocationPct, concentrationRisk, positions: PortfolioPositionContext[] }
  assetScores: AssetScoreContext[]
  marketRegime: { regimeLabel, volatilityLevel, broadTrend, sectorRotation, regimeConfidence }
  macroEvents: MacroEventContext[]
}

SynthesisOutput: {
  weightRationale: { technical, sentiment, fundamental, regime, reasoning }
  portfolioAssessment: { goalStatus, primaryRisk, assessment }
  recommendations: SynthesisRecommendation[]
  portfolioNarrative: string
  overallConfidence: number
  lowConfidenceReasons: string[]
}
```

**`/shared/types/recommendations.ts`**
```
RecommendationRun: { id, portfolioId, runDate, synthesisRunId, overallConfidence, goalStatus, portfolioNarrative, weightRationale, generatedAt }
RecommendationItem: { id, runId, ticker, action, urgency, currentAllocationPct, targetAllocationPct, llmReasoning, confidence, rulesEngineApplied, rulesEngineNote, priority }
UserDecision: { id, recommendationId, decision, decidedAt, userNote }
```

### Task 3 — Create the shared Supabase client

**`/shared/lib/supabase.ts`**

Export two clients:
- `createSupabaseClient()` — for server-side use (service role key)
- `createSupabaseBrowserClient()` — for client-side use (anon key)

Use `@supabase/supabase-js`. Import env vars, never hardcode.

**`/shared/lib/constants.ts`**

Export:
- `ASSET_UNIVERSE` — the full list of 100 tickers (60 stocks, 20 ETFs, 20 crypto).
  Use well-known, liquid assets. Stocks: AAPL, MSFT, NVDA, GOOGL, AMZN, META, TSLA,
  BRK.B, JPM, V, JNJ, UNH, XOM, PG, HD, MA, LLY, ABBV, MRK, PEP, KO, AVGO, COST,
  ADBE, CRM, NFLX, AMD, QCOM, TXN, HON, BA, CAT, GS, MS, BAC, WMT, TGT, DIS, INTC,
  IBM, GE, F, GM, UBER, LYFT, SHOP, SQ, PYPL, NOW, SNOW, PLTR, COIN, RBLX, HOOD,
  SOFI, RIVN, LCID, NIO, BABA, JD, PDD, PINS, SNAP
  ETFs: SPY, QQQ, IWM, VTI, VOO, VEA, EEM, GLD, SLV, USO, TLT, HYG, LQD, XLK, XLF,
  XLE, XLV, XLI, ARKK, SCHD
  Crypto: BTC, ETH, BNB, SOL, XRP, ADA, AVAX, DOT, LINK, MATIC, LTC, BCH, ATOM,
  UNI, AAVE, FIL, ICP, ALGO, XLM, VET
- `SCORE_THRESHOLDS` — the buy/sell/hold ranges from CLAUDE.md
- `DEFAULT_AGENT_WEIGHTS` — { technical: 0.50, sentiment: 0.25, fundamental: 0.20, regime: 0.05 }
- `SENTIMENT_DECAY_FACTOR` — 0.9
- `MAX_POSITIONS_DEFAULT` — 10
- `SYNTHESIS_MODEL` — 'claude-sonnet-4-20250514'

### Task 4 — Create frontend and backend package.json files

**`/frontend/package.json`**
Dependencies: next@14, react, react-dom, @supabase/supabase-js, @supabase/auth-helpers-nextjs, tailwindcss, typescript, zod, lucide-react, recharts

**`/backend/package.json`**
Dependencies: @supabase/supabase-js, @anthropic-ai/sdk, typescript, zod, node-cron, axios, dotenv

### Task 5 — Create Next.js config files

In `/frontend/`:
- `next.config.js` (minimal, with env var passthrough)
- `tailwind.config.js`
- `tsconfig.json` (extends root, with Next.js paths)
- `app/layout.tsx` (root layout, minimal — just html/body with Tailwind font)
- `app/page.tsx` (placeholder — just returns "Portfolio Advisor — Loading")

### Task 6 — Write AGENT_NOTES.md

Create `/AGENT_NOTES_ORCHESTRATOR.md` listing:
- Every file you created
- The shared type exports (so other agents know what to import)
- Any assumptions you made that other agents need to know
- The install command to run before agents start: `npm install` at root

---

## What You Must NOT Do

- Do not write any database migrations (Database Agent's job)
- Do not write any ingestion logic (Pipeline Agent's job)
- Do not write any scoring logic (Analysis Agent's job)
- Do not write any UI components beyond the bare Next.js shell (Frontend Agent's job)
- Do not put any real API keys anywhere — use .env.example only

---

## Definition of Done

- [ ] All directories from CLAUDE.md exist
- [ ] All 5 shared type files compile with no errors
- [ ] Supabase client exports work
- [ ] Constants file has the full 100-asset universe
- [ ] Frontend compiles (npx tsc --noEmit in /frontend)
- [ ] AGENT_NOTES_ORCHESTRATOR.md is complete
- [ ] .env.example has every variable documented

When complete, output a summary of all files created so the human knows
it's safe to start the four parallel agents.
