-- Migration 008: Create portfolio tables
-- portfolios: one or more portfolios per user
-- portfolio_positions: individual asset holdings
-- portfolio_valuations: daily valuation snapshot (composite PK)
-- portfolio_risk_metrics: daily risk metrics snapshot (composite PK)

CREATE TABLE IF NOT EXISTS portfolios (
  id         UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID                  NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  name       TEXT                  NOT NULL,
  created_at TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  status     portfolio_status_enum NOT NULL DEFAULT 'active'
);

DROP TRIGGER IF EXISTS trg_portfolios_updated_at ON portfolios;
CREATE TRIGGER trg_portfolios_updated_at
  BEFORE UPDATE ON portfolios
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS portfolio_positions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id       UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker             TEXT        NOT NULL REFERENCES assets(ticker),
  quantity           NUMERIC     NOT NULL,
  avg_purchase_price NUMERIC     NOT NULL,
  opened_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at          TIMESTAMPTZ,           -- NULL = position is open
  is_active          BOOLEAN     NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS portfolio_valuations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id          UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  date                  DATE        NOT NULL,
  total_value           NUMERIC     NOT NULL,
  cash_value            NUMERIC     NOT NULL DEFAULT 0,
  invested_value        NUMERIC     NOT NULL DEFAULT 0,
  daily_pnl             NUMERIC,
  daily_pnl_pct         NUMERIC,
  cumulative_return_pct NUMERIC,
  goal_probability_pct  NUMERIC,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_risk_metrics (
  portfolio_id         UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  date                 DATE        NOT NULL,
  volatility           NUMERIC     NOT NULL CHECK (volatility >= 0),
  max_drawdown_pct     NUMERIC     NOT NULL CHECK (max_drawdown_pct >= 0 AND max_drawdown_pct <= 1),
  diversification_score NUMERIC    NOT NULL CHECK (diversification_score >= 0 AND diversification_score <= 1),
  concentration_risk   NUMERIC     NOT NULL CHECK (concentration_risk >= 0 AND concentration_risk <= 1),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (portfolio_id, date)
);
