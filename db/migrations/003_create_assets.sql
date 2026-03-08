-- Migration 003: Create assets table
-- Master reference table for the 100-asset investment universe.
-- Populated via seed data; shared across all users (no RLS).

CREATE TABLE IF NOT EXISTS assets (
  ticker      TEXT              PRIMARY KEY,
  name        TEXT              NOT NULL,
  asset_type  asset_type_enum   NOT NULL,
  sector      TEXT              NOT NULL DEFAULT 'N/A',  -- sector classification
  active      BOOLEAN           NOT NULL DEFAULT TRUE
);
