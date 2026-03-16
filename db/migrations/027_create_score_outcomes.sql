-- Migration 027: Create score_outcomes table for all-asset forward-return tracking.
-- Tracks realized forward returns for every scored ticker/date, not just recommended assets.
-- Used as the primary source for score→expected-return calibration.

CREATE TABLE IF NOT EXISTS score_outcomes (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker                TEXT        NOT NULL,
  score_date            DATE        NOT NULL,
  asset_type            TEXT        NOT NULL,
  composite_score       NUMERIC     NOT NULL,
  confidence            NUMERIC     NOT NULL,
  data_freshness        TEXT        NOT NULL,
  score_bucket          TEXT        NOT NULL,
  confidence_bucket     TEXT        NOT NULL,
  price_at_score        NUMERIC,
  price_1d              NUMERIC,
  price_7d              NUMERIC,
  price_30d             NUMERIC,
  return_1d             NUMERIC,
  return_7d             NUMERIC,
  return_30d            NUMERIC,
  benchmark_return_1d   NUMERIC,
  benchmark_return_7d   NUMERIC,
  benchmark_return_30d  NUMERIC,
  beat_benchmark_7d     BOOLEAN,
  beat_benchmark_30d    BOOLEAN,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(ticker, score_date)
);

CREATE INDEX IF NOT EXISTS idx_score_outcomes_date ON score_outcomes(score_date);
CREATE INDEX IF NOT EXISTS idx_score_outcomes_bucket ON score_outcomes(score_bucket);
CREATE INDEX IF NOT EXISTS idx_score_outcomes_asset_type ON score_outcomes(asset_type);
