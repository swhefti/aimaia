-- Migration 028: Extend portfolio_risk_metrics with v2 optimizer metrics.
-- Adds columns for the richer risk model: correlation, crypto allocation, largest position.

ALTER TABLE portfolio_risk_metrics
  ADD COLUMN IF NOT EXISTS avg_pairwise_correlation NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS crypto_allocation_pct     NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS largest_position_pct      NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tickers_with_vol_data     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS portfolio_expected_return  NUMERIC DEFAULT 0;
