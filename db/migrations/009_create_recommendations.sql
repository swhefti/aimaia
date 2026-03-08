-- Migration 009: Create recommendation tables
-- recommendation_runs: one run per portfolio per day, linked to a synthesis run
-- recommendation_items: individual asset-level recommendations within a run
-- user_decisions: user approvals / dismissals of individual recommendations

CREATE TABLE IF NOT EXISTS recommendation_runs (
  id                 UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id       UUID               NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  run_date           DATE               NOT NULL,
  synthesis_run_id   UUID,              -- FK to synthesis_runs added after that table exists
  overall_confidence NUMERIC,
  goal_status        goal_status_enum   NOT NULL,
  portfolio_narrative TEXT,
  weight_rationale   JSONB              NOT NULL,  -- {technical, sentiment, fundamental, regime, reasoning}
  fallback_used      BOOLEAN            NOT NULL DEFAULT FALSE,
  generated_at       TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS recommendation_items (
  id                    UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                UUID                        NOT NULL REFERENCES recommendation_runs(id) ON DELETE CASCADE,
  ticker                TEXT                        NOT NULL REFERENCES assets(ticker),
  action                recommendation_action_enum  NOT NULL,
  urgency               recommendation_urgency_enum NOT NULL,
  current_allocation_pct NUMERIC,
  target_allocation_pct  NUMERIC,
  allocation_change_pct  NUMERIC,
  llm_reasoning         TEXT,
  confidence            NUMERIC,
  rules_engine_applied  BOOLEAN                     NOT NULL DEFAULT FALSE,
  rules_engine_note     TEXT,
  priority              INTEGER                     NOT NULL,
  created_at            TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_decisions (
  id                UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID               NOT NULL REFERENCES recommendation_items(id) ON DELETE CASCADE,
  user_id           UUID               NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  decision          user_decision_enum NOT NULL,
  user_note         TEXT,
  decided_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

-- Add FK from recommendation_runs to synthesis_runs (deferred — synthesis_runs created in 010)
-- Applied in 010_create_synthesis_audit.sql after synthesis_runs exists.
