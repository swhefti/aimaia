-- Migration 002: Create user_profiles table
-- Links to auth.users which is managed by Supabase Auth.
-- One profile per user — stores investment preferences and goal parameters.

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id                UUID          PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name           TEXT,
  investment_capital     NUMERIC       NOT NULL CHECK (investment_capital > 0),
  time_horizon_months    INTEGER       NOT NULL CHECK (time_horizon_months > 0),
  risk_profile           risk_profile_enum NOT NULL,
  goal_return_pct        NUMERIC       NOT NULL,  -- decimal, e.g. 0.12 for 12%
  max_drawdown_limit_pct NUMERIC       NOT NULL CHECK (max_drawdown_limit_pct > 0 AND max_drawdown_limit_pct <= 1),
  volatility_tolerance   volatility_tolerance_enum NOT NULL,
  asset_types            TEXT[]        NOT NULL,  -- subset of ['stock', 'etf', 'crypto']
  max_positions          INTEGER       NOT NULL CHECK (max_positions > 0),
  rebalancing_preference TEXT          NOT NULL DEFAULT 'daily',
  onboarding_completed_at TIMESTAMPTZ,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Automatically update updated_at on row modification
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER trg_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
