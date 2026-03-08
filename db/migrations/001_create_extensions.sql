-- Migration 001: Enable extensions and create shared ENUM types
-- All ENUMs are defined here first so subsequent migrations can reference them.

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE asset_type_enum AS ENUM ('stock', 'etf', 'crypto');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_profile_enum AS ENUM ('conservative', 'balanced', 'aggressive');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE volatility_tolerance_enum AS ENUM ('moderate', 'balanced', 'tolerant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE goal_status_enum AS ENUM ('on_track', 'monitor', 'at_risk', 'off_track');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE agent_type_enum AS ENUM ('technical', 'sentiment', 'fundamental', 'market_regime');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE data_freshness_enum AS ENUM ('current', 'stale', 'missing');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE macro_event_type_enum AS ENUM ('fed_decision', 'earnings', 'geopolitical', 'economic_data', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE recommendation_action_enum AS ENUM ('BUY', 'SELL', 'REDUCE', 'ADD', 'HOLD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE recommendation_urgency_enum AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE portfolio_status_enum AS ENUM ('active', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE user_decision_enum AS ENUM ('approved', 'dismissed', 'deferred');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
