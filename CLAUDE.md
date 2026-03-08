# Portfolio Advisor — Root Coordination File
# All agents read this file before doing anything else.

## What We're Building
A multi-agent investment portfolio advisor. Users set a financial goal, the system
analyzes 100 assets daily (60 stocks, 20 ETFs, 20 crypto), reasons about the user's
portfolio holistically using an LLM Synthesis Agent, and delivers plain-language
recommendations and a daily briefing.

The full specs are in /docs:
- /docs/Product_Overview_User_Experience_v2.docx
- /docs/Multi-Agent_System_Architecture_v2.docx
- /docs/Data_Database_Architecture_v2.docx
- /docs/LLM_Synthesis_Agent_Spec.docx

Read the relevant spec(s) before writing any code.

---

## Monorepo Structure

```
/
├── CLAUDE.md                  ← you are here
├── .env.example               ← all required env vars documented
├── docs/                      ← spec documents (read-only)
├── shared/
│   ├── types/                 ← ALL TypeScript interfaces live here
│   │   ├── assets.ts
│   │   ├── scores.ts
│   │   ├── portfolio.ts
│   │   ├── synthesis.ts
│   │   └── recommendations.ts
│   └── lib/
│       ├── supabase.ts        ← shared Supabase client
│       └── constants.ts       ← universe tickers, score ranges, etc.
├── db/                        ← DATABASE AGENT owns this
│   ├── migrations/            ← numbered SQL files
│   ├── seeds/                 ← asset universe seed data
│   └── rls/                   ← row-level security policies
├── backend/
│   └── pipeline/              ← PIPELINE AGENT owns this
│       ├── ingestion/
│       ├── providers/
│       └── scheduler/
├── agents/                    ← ANALYSIS AGENT owns this
│   ├── technical/
│   ├── sentiment/
│   ├── fundamental/
│   ├── regime/
│   └── synthesis/
└── frontend/                  ← FRONTEND AGENT owns this
    ├── app/
    ├── components/
    └── lib/
```

**File ownership is strict. Never edit files outside your assigned directory.**
The only exceptions are /shared/types/ and /shared/lib/ — any agent may ADD
to these but must not delete or break existing exports.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth |
| Backend runtime | Node.js 20 + TypeScript |
| Frontend | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| LLM calls | Anthropic SDK (claude-sonnet-4-20250514) |
| Market data | Twelve Data (OHLCV) + Finnhub (news, fundamentals) |
| Package manager | npm |
| Validation | Zod |

---

## Naming Conventions

- **Database**: snake_case for all table names, column names, migration files
- **TypeScript**: PascalCase for interfaces/types, camelCase for variables/functions
- **Files**: kebab-case for all files and directories
- **API routes**: /api/[resource]/[action] pattern

---

## Environment Variables

All agents assume these env vars exist. Never hardcode values.

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic
ANTHROPIC_API_KEY=

# Market Data
TWELVE_DATA_API_KEY=
FINNHUB_API_KEY=

# App
NEXT_PUBLIC_APP_URL=
NODE_ENV=
```

---

## Score Contract — Non-Negotiable

All agent scores MUST be normalized to this range. No exceptions.

```
-1.0  =  extremely bearish
 0.0  =  neutral
+1.0  =  extremely bullish
```

Confidence values: 0.0 (no confidence) to 1.0 (high confidence).

Combined score → signal mapping:
- +0.60 to +1.00 → Strong Buy
- +0.20 to +0.59 → Buy
- -0.19 to +0.19 → Hold
- -0.59 to -0.20 → Sell / Reduce
- -1.00 to -0.60 → Strong Sell

---

## Supabase Table Names — Authoritative List

Use exactly these names. Do not invent alternatives.

```
users                    (managed by Supabase Auth)
user_profiles
assets
price_history
market_quotes
news_data
fundamental_data
macro_events
agent_scores
synthesis_inputs
portfolios
portfolio_positions
portfolio_valuations
portfolio_risk_metrics
recommendation_runs
recommendation_items
user_decisions
synthesis_runs
synthesis_raw_outputs
```

---

## The Daily Cycle — Execution Order

This is the sequence the system runs each day. Agents must produce outputs
compatible with this pipeline.

```
1.  Ingest OHLCV + quotes          → price_history, market_quotes
2.  Ingest news                    → news_data
3.  Ingest fundamentals            → fundamental_data
4.  Extract macro events           → macro_events
5.  Run Technical Agent (all 100)  → agent_scores
6.  Run Sentiment Agent (all 100)  → agent_scores
7.  Run Fundamental Agent (all 100)→ agent_scores
8.  Run Regime Agent (once, shared)→ agent_scores
9.  Assemble context per user      → synthesis_inputs
10. Run LLM Synthesis per user     → synthesis_runs, synthesis_raw_outputs
11. Apply Rules Engine per user    → recommendation_runs, recommendation_items
12. Update portfolio valuations    → portfolio_valuations, portfolio_risk_metrics
13. Dashboard reads on next load   → (frontend reads from DB)
```

---

## Cross-Agent Contracts

### Pipeline Agent → Analysis Agent
Pipeline writes to: `price_history`, `news_data`, `fundamental_data`, `macro_events`
Analysis reads from: same tables (never from external APIs directly)

### Analysis Agent → Synthesis Agent
Analysis writes to: `agent_scores`
Synthesis reads from: `agent_scores` + `portfolio_positions` + `user_profiles` + `macro_events`

### Synthesis Agent → Frontend
Synthesis writes to: `recommendation_runs`, `recommendation_items`, `synthesis_runs`
Frontend reads from: all tables via Supabase (read-only on client side)

---

## Error Handling Standards

- All async functions: try/catch with typed errors
- Database errors: log with context, never silently swallow
- LLM call failure: fall back to rules-based output, log to synthesis_runs (fallback_used: true)
- External API failure: retry once with 2s delay, then mark data_freshness as 'stale'
- Never throw unhandled promise rejections

---

## When You're Done with a Task

1. Make sure TypeScript compiles with no errors: `npx tsc --noEmit`
2. Make sure your code is consistent with the shared types
3. Leave a `## Status` section at the bottom of your AGENT_NOTES.md
   listing what's complete, what's stubbed, and what the next agent needs

---

## What This Product Is NOT

- Not a trading bot — it never executes trades
- Not real-time — daily snapshots only
- Not financial advice — always frame recommendations as suggestions

---
