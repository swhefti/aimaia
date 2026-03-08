-- Row Level Security Policies
-- Run after all migrations have been applied.
-- Public tables (assets, price_history, market_quotes, news_data,
-- fundamental_data, macro_events, agent_scores) have no RLS — they are
-- shared read-only market data accessible to all authenticated users.

-- ===========================================================================
-- user_profiles
-- Users can read and update only their own profile.
-- ===========================================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_profiles: owner read"   ON user_profiles;
DROP POLICY IF EXISTS "user_profiles: owner insert"  ON user_profiles;
DROP POLICY IF EXISTS "user_profiles: owner update"  ON user_profiles;

CREATE POLICY "user_profiles: owner read"
  ON user_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "user_profiles: owner insert"
  ON user_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profiles: owner update"
  ON user_profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- ===========================================================================
-- portfolios
-- Users can read, create, and update only their own portfolios.
-- ===========================================================================
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolios: owner read"   ON portfolios;
DROP POLICY IF EXISTS "portfolios: owner insert"  ON portfolios;
DROP POLICY IF EXISTS "portfolios: owner update"  ON portfolios;

CREATE POLICY "portfolios: owner read"
  ON portfolios FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "portfolios: owner insert"
  ON portfolios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "portfolios: owner update"
  ON portfolios FOR UPDATE
  USING (auth.uid() = user_id);

-- ===========================================================================
-- portfolio_positions
-- Accessible only via portfolio ownership chain.
-- ===========================================================================
ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_positions: owner read"   ON portfolio_positions;
DROP POLICY IF EXISTS "portfolio_positions: owner insert"  ON portfolio_positions;
DROP POLICY IF EXISTS "portfolio_positions: owner update"  ON portfolio_positions;
DROP POLICY IF EXISTS "portfolio_positions: owner delete"  ON portfolio_positions;

CREATE POLICY "portfolio_positions: owner read"
  ON portfolio_positions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "portfolio_positions: owner insert"
  ON portfolio_positions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "portfolio_positions: owner update"
  ON portfolio_positions FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "portfolio_positions: owner delete"
  ON portfolio_positions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- portfolio_valuations
-- Accessible only via portfolio ownership chain.
-- ===========================================================================
ALTER TABLE portfolio_valuations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_valuations: owner read" ON portfolio_valuations;
DROP POLICY IF EXISTS "portfolio_valuations: owner insert" ON portfolio_valuations;
DROP POLICY IF EXISTS "portfolio_valuations: owner update" ON portfolio_valuations;

CREATE POLICY "portfolio_valuations: owner read"
  ON portfolio_valuations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "portfolio_valuations: owner insert"
  ON portfolio_valuations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "portfolio_valuations: owner update"
  ON portfolio_valuations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- portfolio_risk_metrics
-- Accessible only via portfolio ownership chain.
-- ===========================================================================
ALTER TABLE portfolio_risk_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_risk_metrics: owner read"   ON portfolio_risk_metrics;
DROP POLICY IF EXISTS "portfolio_risk_metrics: owner insert"  ON portfolio_risk_metrics;

CREATE POLICY "portfolio_risk_metrics: owner read"
  ON portfolio_risk_metrics FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "portfolio_risk_metrics: owner insert"
  ON portfolio_risk_metrics FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- recommendation_runs
-- Accessible only via portfolio ownership chain.
-- ===========================================================================
ALTER TABLE recommendation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recommendation_runs: owner read"   ON recommendation_runs;
DROP POLICY IF EXISTS "recommendation_runs: owner insert"  ON recommendation_runs;

CREATE POLICY "recommendation_runs: owner read"
  ON recommendation_runs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "recommendation_runs: owner insert"
  ON recommendation_runs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- recommendation_items
-- Accessible only via recommendation_run → portfolio → user chain.
-- ===========================================================================
ALTER TABLE recommendation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recommendation_items: owner read"   ON recommendation_items;
DROP POLICY IF EXISTS "recommendation_items: owner insert"  ON recommendation_items;

CREATE POLICY "recommendation_items: owner read"
  ON recommendation_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM recommendation_runs rr
      JOIN portfolios p ON p.id = rr.portfolio_id
      WHERE rr.id = run_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "recommendation_items: owner insert"
  ON recommendation_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM recommendation_runs rr
      JOIN portfolios p ON p.id = rr.portfolio_id
      WHERE rr.id = run_id AND p.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- user_decisions
-- Users can read and write only their own decisions.
-- ===========================================================================
ALTER TABLE user_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_decisions: owner read"   ON user_decisions;
DROP POLICY IF EXISTS "user_decisions: owner insert"  ON user_decisions;

CREATE POLICY "user_decisions: owner read"
  ON user_decisions FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM recommendation_items ri
      JOIN recommendation_runs rr ON rr.id = ri.run_id
      JOIN portfolios p ON p.id = rr.portfolio_id
      WHERE ri.id = recommendation_id AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "user_decisions: owner insert"
  ON user_decisions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM recommendation_items ri
      JOIN recommendation_runs rr ON rr.id = ri.run_id
      JOIN portfolios p ON p.id = rr.portfolio_id
      WHERE ri.id = recommendation_id AND p.user_id = auth.uid()
    )
  );

-- ===========================================================================
-- synthesis_inputs
-- Users can only read their own synthesis inputs (written server-side).
-- ===========================================================================
ALTER TABLE synthesis_inputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "synthesis_inputs: owner read"   ON synthesis_inputs;
DROP POLICY IF EXISTS "synthesis_inputs: service insert" ON synthesis_inputs;

CREATE POLICY "synthesis_inputs: owner read"
  ON synthesis_inputs FOR SELECT
  USING (auth.uid() = user_id);

-- Server-side pipeline uses service role key (bypasses RLS), so no insert policy needed.

-- ===========================================================================
-- synthesis_runs
-- Users can only read their own synthesis runs (written server-side).
-- ===========================================================================
ALTER TABLE synthesis_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "synthesis_runs: owner read" ON synthesis_runs;

CREATE POLICY "synthesis_runs: owner read"
  ON synthesis_runs FOR SELECT
  USING (auth.uid() = user_id);

-- ===========================================================================
-- synthesis_raw_outputs
-- Users can only read their own raw outputs (written server-side).
-- ===========================================================================
ALTER TABLE synthesis_raw_outputs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "synthesis_raw_outputs: owner read" ON synthesis_raw_outputs;

CREATE POLICY "synthesis_raw_outputs: owner read"
  ON synthesis_raw_outputs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM synthesis_runs sr
      WHERE sr.id = synthesis_run_id AND sr.user_id = auth.uid()
    )
  );
