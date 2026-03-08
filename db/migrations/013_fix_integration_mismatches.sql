-- Migration 013: Fix integration mismatches between agents and DB schema
--
-- Issues addressed:
-- 1. macro_event_type_enum: Missing enum values the pipeline LLM prompt can produce
-- 2. MARKET sentinel: Regime agent writes ticker='MARKET' but no such row in assets
-- 3. portfolio_positions.opened_at: NOT NULL with no DEFAULT — frontend inserts omit it
--
-- Note: market_quotes schema is correct (last_price, daily_change, pct_change).
-- Pipeline code was fixed to write the correct columns.
-- synthesis_runs and synthesis_raw_outputs already match the live DB.

-- ---------------------------------------------------------------------------
-- 1. Add missing macro_event_type_enum values (idempotent)
-- ---------------------------------------------------------------------------
ALTER TYPE macro_event_type_enum ADD VALUE IF NOT EXISTS 'cpi_release';
ALTER TYPE macro_event_type_enum ADD VALUE IF NOT EXISTS 'jobs_report';
ALTER TYPE macro_event_type_enum ADD VALUE IF NOT EXISTS 'regulatory';
ALTER TYPE macro_event_type_enum ADD VALUE IF NOT EXISTS 'trade_policy';
ALTER TYPE macro_event_type_enum ADD VALUE IF NOT EXISTS 'market_crash';
ALTER TYPE macro_event_type_enum ADD VALUE IF NOT EXISTS 'sector_rotation';

-- ---------------------------------------------------------------------------
-- 2. Add MARKET sentinel row to assets for the regime agent
-- ---------------------------------------------------------------------------
INSERT INTO assets (ticker, name, asset_type, sector, active)
VALUES ('MARKET', 'Market Regime', 'stock', 'N/A', TRUE)
ON CONFLICT (ticker) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Add DEFAULT NOW() to portfolio_positions.opened_at
-- ---------------------------------------------------------------------------
ALTER TABLE portfolio_positions ALTER COLUMN opened_at SET DEFAULT NOW();
