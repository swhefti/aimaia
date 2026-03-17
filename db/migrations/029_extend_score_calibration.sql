-- Migration 029: Extend score_calibration with rollout-safety metadata.
-- Adds sample-count detail, eligibility flags, and staleness tracking.

ALTER TABLE score_calibration
  ADD COLUMN IF NOT EXISTS sample_count_7d     INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sample_count_30d    INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_live_eligible    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS eligibility_reason  TEXT,
  ADD COLUMN IF NOT EXISTS calibration_source  TEXT DEFAULT 'score_outcomes',
  ADD COLUMN IF NOT EXISTS updated_at          TIMESTAMPTZ DEFAULT NOW();
