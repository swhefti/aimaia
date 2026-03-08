-- Seed 002: Test user profile
-- Inserts a sample user_profile for local development and testing.
-- The corresponding auth.users record must be created via Supabase Auth
-- (e.g., via the Supabase dashboard or signup flow) before running this seed.
--
-- Replace '00000000-0000-0000-0000-000000000001' with the actual UUID
-- of the test user created in Supabase Auth.

DO $$
DECLARE
  v_test_user_id UUID := '00000000-0000-0000-0000-000000000001';
BEGIN
  -- Only insert if the auth user exists and no profile exists yet
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_test_user_id)
     AND NOT EXISTS (SELECT 1 FROM user_profiles WHERE user_id = v_test_user_id)
  THEN
    INSERT INTO user_profiles (
      user_id,
      investment_capital,
      time_horizon_months,
      risk_profile,
      goal_return_pct,
      max_drawdown_limit_pct,
      volatility_tolerance,
      asset_types,
      max_positions
    ) VALUES (
      v_test_user_id,
      10000,             -- $10,000 starting capital
      12,                -- 12-month horizon
      'balanced',
      0.10,              -- 10% target annual return
      0.25,              -- 25% max drawdown limit
      'balanced',
      ARRAY['stock', 'etf'],
      8
    );
    RAISE NOTICE 'Test user profile inserted for user_id %', v_test_user_id;
  ELSE
    RAISE NOTICE 'Skipping test user seed — auth user not found or profile already exists.';
  END IF;
END $$;
