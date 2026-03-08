# Portfolio Advisor

A multi-agent investment portfolio advisor. Users set a financial goal; the system analyzes 100 assets daily and delivers plain-language recommendations and a daily briefing.

## Architecture

Five-layer system: Market Data → Analysis Agents → LLM Synthesis → Rules Engine → Portfolio Decision Engine.

## Agent Ownership Map

| Directory | Owner Agent |
|---|---|
| `db/` | Database Agent |
| `backend/pipeline/` | Pipeline Agent |
| `agents/` | Analysis Agent |
| `frontend/` | Frontend Agent |
| `shared/types/` | Orchestrator (read-only for others) |
| `shared/lib/` | Orchestrator (additive for others) |

## Tech Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL via Supabase |
| Auth | Supabase Auth |
| Backend runtime | Node.js 20 + TypeScript |
| Frontend | Next.js 14 (App Router) |
| Styling | Tailwind CSS |
| LLM calls | Anthropic SDK (claude-opus-4-6) |
| Market data | Twelve Data + Finnhub |
| Package manager | npm |
| Validation | Zod |

## Getting Started

### Prerequisites
- Node.js 20+
- A Supabase project
- Anthropic API key
- Twelve Data API key
- Finnhub API key

### Setup

```bash
# 1. Clone the repo
git clone <repo-url>
cd portfolio-advisor

# 2. Install all dependencies (root + workspaces)
npm install

# 3. Copy env file and fill in values
cp .env.example .env

# 4. Run database migrations (Database Agent output)
# See db/migrations/ — run in Supabase SQL editor or via CLI

# 5. Start the frontend
npm run dev:frontend

# 6. Start the backend pipeline (separate terminal)
npm run dev:backend
```

## Daily Pipeline

```
1.  Ingest OHLCV + quotes          → price_history, market_quotes
2.  Ingest news                    → news_data
3.  Ingest fundamentals            → fundamental_data
4.  Extract macro events           → macro_events
5.  Run Technical Agent (all 100)  → agent_scores
6.  Run Sentiment Agent (all 100)  → agent_scores
7.  Run Fundamental Agent (all 100)→ agent_scores
8.  Run Regime Agent (once)        → agent_scores
9.  Assemble context per user      → synthesis_inputs
10. Run LLM Synthesis per user     → synthesis_runs, synthesis_raw_outputs
11. Apply Rules Engine per user    → recommendation_runs, recommendation_items
12. Update portfolio valuations    → portfolio_valuations, portfolio_risk_metrics
13. Dashboard reads on next load   → (frontend reads from DB)
```

## Score Contract

All agent scores normalized to: `-1.0` (extremely bearish) → `+1.0` (extremely bullish)

| Range | Signal |
|---|---|
| +0.60 to +1.00 | Strong Buy |
| +0.20 to +0.59 | Buy |
| -0.19 to +0.19 | Hold |
| -0.59 to -0.20 | Sell / Reduce |
| -1.00 to -0.60 | Strong Sell |

## Disclaimer

This tool is not financial advice. It never executes trades. Recommendations are suggestions only.
