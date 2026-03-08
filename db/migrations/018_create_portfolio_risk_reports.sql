-- Migration 018: Create portfolio_risk_reports table
-- Stores LLM-generated risk analysis reports for portfolios.

CREATE TABLE IF NOT EXISTS portfolio_risk_reports (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  report        TEXT        NOT NULL,
  model_used    TEXT        NOT NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_risk_reports_portfolio
  ON portfolio_risk_reports(portfolio_id, generated_at DESC);

-- RLS
ALTER TABLE portfolio_risk_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own risk reports"
  ON portfolio_risk_reports FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own risk reports"
  ON portfolio_risk_reports FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own risk reports"
  ON portfolio_risk_reports FOR DELETE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- Service role bypass (for API routes)
CREATE POLICY "Service role full access to risk reports"
  ON portfolio_risk_reports FOR ALL
  USING (auth.role() = 'service_role');
