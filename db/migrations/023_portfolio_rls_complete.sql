-- Migration 023: Ensure complete RLS policies for all portfolio tables
-- Fixes missing INSERT/SELECT/UPDATE policies that cause silent failures

-- Enable RLS on all portfolio tables (idempotent)
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_valuations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_risk_metrics ENABLE ROW LEVEL SECURITY;

-- =================== portfolios ===================
DROP POLICY IF EXISTS "portfolios: owner select" ON portfolios;
CREATE POLICY "portfolios: owner select" ON portfolios
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "portfolios: owner insert" ON portfolios;
CREATE POLICY "portfolios: owner insert" ON portfolios
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "portfolios: owner update" ON portfolios;
CREATE POLICY "portfolios: owner update" ON portfolios
  FOR UPDATE USING (user_id = auth.uid());

-- =================== portfolio_positions ===================
DROP POLICY IF EXISTS "portfolio_positions: owner select" ON portfolio_positions;
CREATE POLICY "portfolio_positions: owner select" ON portfolio_positions
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "portfolio_positions: owner insert" ON portfolio_positions;
CREATE POLICY "portfolio_positions: owner insert" ON portfolio_positions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "portfolio_positions: owner update" ON portfolio_positions;
CREATE POLICY "portfolio_positions: owner update" ON portfolio_positions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

-- DELETE policy already exists from migration 014, recreate for completeness
DROP POLICY IF EXISTS "portfolio_positions: owner delete" ON portfolio_positions;
CREATE POLICY "portfolio_positions: owner delete" ON portfolio_positions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

-- =================== portfolio_valuations ===================
DROP POLICY IF EXISTS "portfolio_valuations: owner select" ON portfolio_valuations;
CREATE POLICY "portfolio_valuations: owner select" ON portfolio_valuations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "portfolio_valuations: owner insert" ON portfolio_valuations;
CREATE POLICY "portfolio_valuations: owner insert" ON portfolio_valuations
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

-- UPDATE policy already exists from migration 014, recreate for completeness
DROP POLICY IF EXISTS "portfolio_valuations: owner update" ON portfolio_valuations;
CREATE POLICY "portfolio_valuations: owner update" ON portfolio_valuations
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

-- =================== portfolio_risk_metrics ===================
DROP POLICY IF EXISTS "portfolio_risk_metrics: owner select" ON portfolio_risk_metrics;
CREATE POLICY "portfolio_risk_metrics: owner select" ON portfolio_risk_metrics
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "portfolio_risk_metrics: owner insert" ON portfolio_risk_metrics;
CREATE POLICY "portfolio_risk_metrics: owner insert" ON portfolio_risk_metrics
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "portfolio_risk_metrics: owner update" ON portfolio_risk_metrics;
CREATE POLICY "portfolio_risk_metrics: owner update" ON portfolio_risk_metrics
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = portfolio_id AND p.user_id = auth.uid())
  );
