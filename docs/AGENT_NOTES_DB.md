# Database Agent Notes

## Status

**Complete.** All 12 migrations, RLS policies, seed files, helper functions, and migration runner are created.

---

## Files Created

### Migrations (`db/migrations/`)

| File | What it creates |
|---|---|
| `001_create_extensions.sql` | uuid-ossp, pgcrypto; all 11 ENUM types |
| `002_create_user_profiles.sql` | `user_profiles` table + updated_at trigger |
| `003_create_assets.sql` | `assets` table |
| `004_create_market_data.sql` | `price_history`, `market_quotes` |
| `005_create_news_and_fundamentals.sql` | `news_data`, `fundamental_data` |
| `006_create_macro_events.sql` | `macro_events` |
| `007_create_agent_scores.sql` | `agent_scores`, `synthesis_inputs` |
| `008_create_portfolios.sql` | `portfolios`, `portfolio_positions`, `portfolio_valuations`, `portfolio_risk_metrics` |
| `009_create_recommendations.sql` | `recommendation_runs`, `recommendation_items`, `user_decisions` |
| `010_create_synthesis_audit.sql` | `synthesis_runs`, `synthesis_raw_outputs`; adds FK from `recommendation_runs → synthesis_runs` |
| `011_create_indexes.sql` | 17 performance indexes across all high-traffic tables |
| `012_create_functions.sql` | 3 helper functions (see below) |

### RLS (`db/rls/`)
- `policies.sql` — RLS enabled + policies for all 11 user-scoped tables

### Seeds (`db/seeds/`)
- `001_asset_universe.sql` — all 103 assets (63 stocks, 20 ETFs, 20 crypto) with sector classification
- `002_test_user.sql` — idempotent test profile; replace the UUID with real auth.users id

### Migration Runner
- `db/run_migrations.ts` — TypeScript runner; reads migrations in order, logs per-file result

---

## Helper Functions (012_create_functions.sql)

| Function | Signature | Purpose |
|---|---|---|
| `get_latest_agent_scores` | `(ticker TEXT, date DATE)` | Most recent score per agent type for a ticker (looks back 7 days) |
| `get_user_portfolio_state` | `(user_id UUID, date DATE)` | Open positions with latest market price and goal probability |
| `get_top_scored_assets` | `(date DATE, asset_types TEXT[], limit INT)` | Top N assets by combined weighted score |

---

## Schema Decisions & Notes for Other Agents

### market_regime agent ticker convention
`agent_scores` has a composite PK of `(ticker, date, agent_type)`. The regime agent scores the whole market (not a per-asset score). By convention, **write the regime score with `ticker = 'MARKET'`**. This requires inserting a row in `assets` with `ticker = 'MARKET'` before the regime agent runs, or relaxing the FK. Recommended approach: **add a 'MARKET' sentinel row to assets** via seed or migration.

> Action for Analysis Agent: either insert `('MARKET', 'Market Regime', 'stock', NULL)` into assets before writing regime scores, or query the regime score separately using `WHERE agent_type = 'market_regime'` and join by date only.

### concentration_risk type
The brief mentioned `concentration_risk as enum: LOW, MEDIUM, HIGH`, but the shared TypeScript type (`PortfolioRiskMetrics.concentrationRisk`) defines it as `number [0.0, 1.0]`. The DB column uses `NUMERIC` to match the TypeScript contract. If the frontend needs a label, derive it at query time: `< 0.33 → Low`, `0.33–0.66 → Medium`, `> 0.66 → High`.

### FK ordering (recommendations → synthesis_runs)
`recommendation_runs.synthesis_run_id` references `synthesis_runs`, which is created in migration 010. The FK constraint is added at the end of 010, not in 009. This is intentional — both migrations must run to completion before the FK is valid.

### Immutable tables
`price_history`, `agent_scores`, and `synthesis_raw_outputs` are INSERT-only. The RLS policies intentionally omit UPDATE/DELETE grants. The service role key (bypasses RLS) should also not UPDATE these tables.

### Asset count
The constants file has 103 assets (63 stocks, not 60 as originally specified). The seed file mirrors this exactly.

### Test user seed
`002_test_user.sql` checks for the auth user's existence before inserting. It will silently skip if the auth user `00000000-0000-0000-0000-000000000001` doesn't exist. **Replace that UUID** with a real user created via Supabase Auth before running the seed.

### Migration runner limitation
`run_migrations.ts` calls `supabase.rpc('exec_sql', ...)` which requires a custom `exec_sql` function in the database, or you can run migrations directly via the Supabase SQL editor or `psql`. The runner is provided as a convenience — the SQL files themselves are the canonical migrations.

---

## What the Pipeline Agent Needs to Know

- Insert into `price_history` and `market_quotes` using `(ticker, date)` composite PK — Supabase will reject duplicates automatically.
- Insert into `news_data` using the UUID PK — deduplicate by URL before inserting.
- Insert into `fundamental_data` using `(ticker, date)` composite PK.
- Insert into `macro_events` using UUID PK — classify `event_type` using the enum: `fed_decision | earnings | geopolitical | economic_data | other`.
- All timestamps go in as UTC (`TIMESTAMPTZ`).

## What the Analysis Agent Needs to Know

- Read from `price_history`, `news_data`, `fundamental_data`, `macro_events` only — never call external APIs directly.
- Write scores to `agent_scores` using `(ticker, date, agent_type)` composite PK. One INSERT per agent per ticker per day.
- Regime agent: write with `ticker = 'MARKET'` (see note above).
- `component_scores` is a JSONB column — pass a JSON object with named sub-scores.
- `data_freshness` must be one of: `'current'`, `'stale'`, `'missing'`.
- `agent_version` is a free-text semver string (e.g., `"1.0.0"`).
- Write `synthesis_inputs` rows before calling the LLM — one row per user per run date.

## What the Frontend Agent Needs to Know

- All client-side reads use `createSupabaseBrowserClient()` (anon key, RLS enforced).
- Public tables (`assets`, `price_history`, `market_quotes`, `news_data`, `fundamental_data`, `macro_events`, `agent_scores`) are readable without authentication.
- All user-scoped tables require the user to be authenticated (`auth.uid()` must match).
- Use the helper functions via `supabase.rpc('get_latest_agent_scores', { p_ticker, p_date })` etc.
