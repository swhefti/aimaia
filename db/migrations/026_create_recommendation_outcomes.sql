-- Migration 026: Create recommendation outcome tracking tables
-- Supports optimizer evaluation and expected-return calibration.

-- Per-recommendation forward-return outcomes
CREATE TABLE IF NOT EXISTS recommendation_outcomes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id     UUID        REFERENCES recommendation_items(id) ON DELETE CASCADE,
  ticker                TEXT        NOT NULL,
  run_date              DATE        NOT NULL,
  asset_type            TEXT        NOT NULL,
  action                TEXT        NOT NULL,
  composite_score       NUMERIC,
  confidence            NUMERIC,
  data_freshness        TEXT,
  current_weight_pct    NUMERIC,
  target_weight_pct     NUMERIC,
  expected_return       NUMERIC,
  price_at_decision     NUMERIC,
  price_1d              NUMERIC,
  price_7d              NUMERIC,
  price_30d             NUMERIC,
  return_1d             NUMERIC,
  return_7d             NUMERIC,
  return_30d            NUMERIC,
  benchmark_return_1d   NUMERIC,   -- SPY return for same period
  benchmark_return_7d   NUMERIC,
  benchmark_return_30d  NUMERIC,
  beat_benchmark_7d     BOOLEAN,
  beat_benchmark_30d    BOOLEAN,
  score_bucket          TEXT,       -- e.g. 'strong_buy', 'buy', 'hold', 'sell', 'strong_sell'
  confidence_bucket     TEXT,       -- e.g. 'high', 'medium', 'low'
  evaluated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rec_outcomes_ticker ON recommendation_outcomes(ticker);
CREATE INDEX IF NOT EXISTS idx_rec_outcomes_run_date ON recommendation_outcomes(run_date);
CREATE INDEX IF NOT EXISTS idx_rec_outcomes_action ON recommendation_outcomes(action);
CREATE INDEX IF NOT EXISTS idx_rec_outcomes_score_bucket ON recommendation_outcomes(score_bucket);

-- Backtest run summary
CREATE TABLE IF NOT EXISTS optimizer_backtest_runs (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  start_date            DATE        NOT NULL,
  end_date              DATE        NOT NULL,
  risk_profile          TEXT        NOT NULL DEFAULT 'balanced',
  asset_types           TEXT[]      NOT NULL DEFAULT ARRAY['stock','etf','crypto'],
  max_positions         INTEGER     NOT NULL DEFAULT 8,
  -- Portfolio-level metrics
  cumulative_return_pct NUMERIC,
  annualized_return_pct NUMERIC,
  max_drawdown_pct      NUMERIC,
  realized_volatility   NUMERIC,
  sharpe_ratio          NUMERIC,
  total_turnover        NUMERIC,
  -- Benchmark comparison
  benchmark_return_pct  NUMERIC,    -- SPY cumulative return
  excess_return_pct     NUMERIC,    -- optimizer - benchmark
  -- Recommendation quality
  total_recommendations INTEGER,
  hit_rate_7d           NUMERIC,    -- % of non-HOLD recs with positive 7d return
  hit_rate_30d          NUMERIC,
  avg_return_buy_7d     NUMERIC,
  avg_return_sell_7d    NUMERIC,
  -- Config snapshot
  config_snapshot       JSONB,
  report_json           JSONB,      -- full detailed report
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Score-bucket calibration data (aggregated from outcomes)
CREATE TABLE IF NOT EXISTS score_calibration (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  score_bucket          TEXT        NOT NULL,
  asset_type            TEXT,       -- NULL = all types
  sample_count          INTEGER     NOT NULL,
  avg_forward_return_7d  NUMERIC,
  avg_forward_return_30d NUMERIC,
  median_forward_return_7d NUMERIC,
  hit_rate_7d           NUMERIC,
  hit_rate_30d          NUMERIC,
  calibrated_expected_return NUMERIC, -- the calibrated mapping value
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(score_bucket, asset_type)
);
