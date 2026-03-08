-- Migration 010: Create synthesis audit tables and finalize cross-table FK
-- synthesis_runs: performance and cost tracking for each LLM call
-- synthesis_raw_outputs: raw LLM JSON, post-rules JSON, and override log
-- Also adds the FK from recommendation_runs → synthesis_runs.

CREATE TABLE IF NOT EXISTS synthesis_runs (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  portfolio_id        UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  run_date            DATE        NOT NULL,
  model_used          TEXT        NOT NULL,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  total_tokens        INTEGER,
  latency_ms          INTEGER,
  llm_call_succeeded  BOOLEAN     NOT NULL DEFAULT TRUE,
  fallback_used       BOOLEAN     NOT NULL DEFAULT FALSE,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS synthesis_raw_outputs (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  synthesis_run_id       UUID        NOT NULL REFERENCES synthesis_runs(id) ON DELETE CASCADE,
  raw_llm_output         JSONB       NOT NULL,   -- SynthesisOutput from the model, pre-rules
  post_rules_output      JSONB       NOT NULL,   -- SynthesisOutput after Rules Engine
  overrides_applied      JSONB       NOT NULL DEFAULT '[]',  -- array of override objects
  low_confidence_reasons TEXT[]      NOT NULL DEFAULT '{}',  -- reasons for low confidence
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from recommendation_runs → synthesis_runs now that synthesis_runs exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_recommendation_runs_synthesis_run_id'
      AND table_name = 'recommendation_runs'
  ) THEN
    ALTER TABLE recommendation_runs
      ADD CONSTRAINT fk_recommendation_runs_synthesis_run_id
      FOREIGN KEY (synthesis_run_id) REFERENCES synthesis_runs(id);
  END IF;
END $$;
