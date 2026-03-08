-- Migration 006: Create macro_events table
-- Stores macro-economic events that affect the market broadly or specific sectors.
-- Extracted and classified by the Pipeline Agent; consumed by the LLM Synthesis Agent.

CREATE TABLE IF NOT EXISTS macro_events (
  id                   UUID                   PRIMARY KEY DEFAULT gen_random_uuid(),
  date                 DATE                   NOT NULL,
  event_description    TEXT                   NOT NULL,
  event_type           macro_event_type_enum  NOT NULL,
  relevant_asset_types TEXT[]                 NOT NULL DEFAULT '{}',  -- empty = all asset types
  relevant_tickers     TEXT[]                 NOT NULL DEFAULT '{}',  -- empty = market-wide
  sentiment            NUMERIC                NOT NULL CHECK (sentiment >= -1.0 AND sentiment <= 1.0),
  source_url           TEXT,
  extracted_at         TIMESTAMPTZ            NOT NULL DEFAULT NOW()
);
