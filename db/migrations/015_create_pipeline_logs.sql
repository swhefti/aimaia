-- Migration 015: Create pipeline_logs table for tracking ingestion runs
-- Each pipeline run writes a log entry on success or failure.

CREATE TABLE IF NOT EXISTS pipeline_logs (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_name     TEXT        NOT NULL,   -- e.g. 'daily_full', 'crypto_prices', 'prices_only'
  status       TEXT        NOT NULL,   -- 'success' | 'failure' | 'partial'
  started_at   TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT
);

-- Index for quick lookups by job name and time
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_job_time
  ON pipeline_logs (job_name, completed_at DESC);

-- RLS: service role only (no client access needed)
ALTER TABLE pipeline_logs ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read (for status bar)
CREATE POLICY "pipeline_logs_read_all" ON pipeline_logs
  FOR SELECT USING (true);
