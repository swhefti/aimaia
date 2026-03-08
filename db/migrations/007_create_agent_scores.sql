-- Migration 007: Create agent_scores and synthesis_inputs tables
--
-- agent_scores: daily scores from each analysis agent for each asset.
--   Composite PK (ticker, date, agent_type) ensures one score per agent per asset per day.
--   INSERT-only — never update a score after it is written.
--   Note: market_regime agent produces one score per date; ticker is set to 'MARKET'
--   for the regime score to satisfy the composite PK constraint.
--
-- synthesis_inputs: assembled context package for each user before LLM synthesis.

CREATE TABLE IF NOT EXISTS agent_scores (
  id               UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker           TEXT                NOT NULL REFERENCES assets(ticker),
  date             DATE                NOT NULL,
  agent_type       agent_type_enum     NOT NULL,
  score            NUMERIC             NOT NULL CHECK (score >= -1.0 AND score <= 1.0),
  confidence       NUMERIC             NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  component_scores JSONB               NOT NULL DEFAULT '{}',
  explanation      TEXT,
  data_freshness   data_freshness_enum NOT NULL,
  agent_version    TEXT                NOT NULL,
  created_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, date, agent_type)
);

CREATE TABLE IF NOT EXISTS synthesis_inputs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  run_date        DATE        NOT NULL,
  context_package JSONB       NOT NULL,  -- full SynthesisContextPackage
  asset_scope     TEXT[]      NOT NULL,  -- tickers included in this run
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
