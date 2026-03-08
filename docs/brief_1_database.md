# Agent Brief — Database Agent (Phase 1, parallel)
# Start only after the Orchestrator has completed.

---

## Your Role

You are the Database Agent. You own everything in `/db/`.
You are responsible for the complete Supabase schema — every table,
every index, every row-level security policy, and the seed data for
the 100-asset universe.

The Analysis Agent, Pipeline Agent, and Frontend Agent all depend on
your schema being correct. Get the table names and column names exactly
right — they are defined in CLAUDE.md and the spec docs.

---

## Documents to Read First

1. Read `CLAUDE.md` in the root — especially the table name list and cross-agent contracts
2. Read `/docs/Data_Database_Architecture_v2.docx` — full schema spec with all tables, columns, and types
3. Read `/docs/Multi-Agent_System_Architecture_v2.docx` — section 4 (system layers) and section 15 (daily cycle) so you understand data flow
4. Read `/AGENT_NOTES_ORCHESTRATOR.md` to see what shared types already exist

---

## Your File Ownership

```
/db/
  migrations/       ← you own this entirely
  seeds/            ← you own this entirely
  rls/              ← you own this entirely
```

You may also ADD to (never break):
```
/shared/lib/supabase.ts   ← add helper query functions if useful
```

Do NOT touch: /frontend/, /backend/, /agents/, /shared/types/

---

## Tasks

### Task 1 — Migrations

Create numbered SQL migration files in `/db/migrations/`.
Use format: `001_create_users.sql`, `002_create_assets.sql`, etc.

Each file should be idempotent (`CREATE TABLE IF NOT EXISTS`).
Each file should have a comment header explaining what it creates.

**Migration order (respect foreign key dependencies):**

```
001_create_extensions.sql
  - Enable uuid-ossp extension
  - Enable pgcrypto extension

002_create_user_profiles.sql
  - user_profiles table
  - Links to auth.users (Supabase managed)

003_create_assets.sql
  - assets table (ticker PK, name, asset_type, sector, active bool)

004_create_market_data.sql
  - price_history (ticker, date, open, high, low, close, volume)
  - market_quotes (ticker, date, last_price, daily_change, pct_change)
  - PRIMARY KEY on (ticker, date) for both — no duplicate daily records

005_create_news_and_fundamentals.sql
  - news_data (id uuid, ticker, headline, summary, source, published_at, url, ingested_at)
  - fundamental_data (ticker, date, pe_ratio, ps_ratio, revenue_growth_yoy,
    profit_margin, roe, market_cap, debt_to_equity)
  - PRIMARY KEY on fundamental_data(ticker, date)

006_create_macro_events.sql
  - macro_events table
  - relevant_asset_types and relevant_tickers as text[] arrays
  - event_type as enum: fed_decision, earnings, geopolitical, economic_data, other

007_create_agent_scores.sql
  - agent_scores table
  - agent_type as enum: technical, sentiment, fundamental, market_regime
  - component_scores as jsonb (sub-scores from individual indicators)
  - data_freshness as enum: current, stale, missing
  - PRIMARY KEY on (ticker, date, agent_type)
  - synthesis_inputs table (user_id, run_date, context_package jsonb, asset_scope text[])

008_create_portfolios.sql
  - portfolios table
  - portfolio_positions table
  - portfolio_valuations table (portfolioId, date as composite PK)
  - portfolio_risk_metrics table (portfolioId, date as composite PK)
  - concentration_risk as enum: LOW, MEDIUM, HIGH

009_create_recommendations.sql
  - recommendation_runs table
  - recommendation_items table
  - user_decisions table
  - decision as enum: approved, dismissed, deferred
  - action as enum: BUY, SELL, REDUCE, ADD, HOLD
  - urgency as enum: high, medium, low

010_create_synthesis_audit.sql
  - synthesis_runs table (performance + cost tracking)
  - synthesis_raw_outputs table (raw LLM JSON, post-rules JSON, overrides jsonb)

011_create_indexes.sql
  - price_history: index on (ticker, date DESC)
  - agent_scores: index on (ticker, date DESC), index on (date, agent_type)
  - news_data: index on (ticker, published_at DESC)
  - recommendation_runs: index on (portfolio_id, run_date DESC)
  - synthesis_runs: index on (user_id, run_date DESC)
```

### Task 2 — Row Level Security Policies

Create `/db/rls/policies.sql`.

Apply these RLS policies:

```sql
-- user_profiles: users can only read/write their own profile
-- portfolios: users can only read/write their own portfolios
-- portfolio_positions: accessible only via portfolio ownership chain
-- portfolio_valuations: same
-- portfolio_risk_metrics: same
-- recommendation_runs: accessible only via portfolio ownership chain
-- recommendation_items: accessible only via recommendation_run chain
-- user_decisions: users can only write/read their own decisions
-- synthesis_inputs: users can only read their own
-- synthesis_runs: users can only read their own
-- synthesis_raw_outputs: users can only read their own

-- PUBLIC (no RLS needed — shared data):
-- assets, price_history, market_quotes, news_data, fundamental_data,
-- macro_events, agent_scores
```

Include `ALTER TABLE [name] ENABLE ROW LEVEL SECURITY;` for every protected table.

### Task 3 — Seed Data

Create `/db/seeds/001_asset_universe.sql`.

Insert all 100 assets from `ASSET_UNIVERSE` in `/shared/lib/constants.ts`.
Every asset needs: ticker, name, asset_type, sector, active=true.

Make it idempotent:
```sql
INSERT INTO assets (ticker, name, asset_type, sector)
VALUES (...)
ON CONFLICT (ticker) DO NOTHING;
```

Include accurate sector classifications. Examples:
- NVDA → 'Technology' / stock
- SPY → 'Broad Market' / etf
- BTC → 'Layer 1' / crypto

Create `/db/seeds/002_test_user.sql` — a test user profile with:
- Sample goal: 10% return in 12 months
- balanced risk profile
- max_drawdown_limit_pct: 25
- asset_types: ['stocks', 'etfs']
- max_positions: 8

### Task 4 — Database Helper Functions (optional but valuable)

Create `/db/migrations/012_create_functions.sql` with useful PostgreSQL functions:

```sql
-- get_latest_agent_scores(p_ticker text, p_date date)
--   Returns the most recent score for each agent type for a ticker

-- get_user_portfolio_state(p_user_id uuid, p_date date)
--   Returns current portfolio positions with latest valuations

-- get_top_scored_assets(p_date date, p_asset_types text[], p_limit int)
--   Returns top N assets by combined score for a given date
```

### Task 5 — Write a migration runner script

Create `/db/run_migrations.ts` — a TypeScript script that:
- Reads all SQL files from /db/migrations/ in order
- Executes them against Supabase using the service role key
- Logs success/failure per migration
- Is idempotent (safe to run multiple times)

---

## Critical Details

**Primary keys**: Use `uuid DEFAULT gen_random_uuid()` for all id columns.
**Timestamps**: All timestamp columns use `TIMESTAMPTZ DEFAULT NOW()`.
**Immutability**: price_history, agent_scores, synthesis_raw_outputs should
  never be updated — only inserted. Do not add UPDATE policies for these.
**jsonb columns**: component_scores, context_package, weight_rationale,
  raw_llm_output, post_rules_output, overrides_applied are all jsonb.

---

## Definition of Done

- [ ] All 12 migration files exist and are syntactically valid SQL
- [ ] RLS policies file covers all user-scoped tables
- [ ] Seed file has all 100 assets with correct types and sectors
- [ ] Migration runner script compiles
- [ ] No table names deviate from CLAUDE.md authoritative list
- [ ] AGENT_NOTES_DB.md written: what was created, any schema decisions made,
      what the Pipeline and Analysis agents need to know about data shapes
