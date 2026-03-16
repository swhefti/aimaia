-- Migration 020: Add strategy metadata to portfolios
-- Supports optimizer-first architecture where all portfolios use target-weight optimization.

-- Add strategy columns
ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS strategy_mode TEXT NOT NULL DEFAULT 'pro',
  ADD COLUMN IF NOT EXISTS strategy_version TEXT NOT NULL DEFAULT '1.0';

-- Ensure existing portfolios get sensible defaults (already handled by DEFAULT)
-- Add a CHECK constraint for strategy_mode
ALTER TABLE portfolios
  ADD CONSTRAINT chk_strategy_mode CHECK (strategy_mode IN ('pro'));

-- Index for querying by strategy
CREATE INDEX IF NOT EXISTS idx_portfolios_strategy_mode ON portfolios(strategy_mode);
