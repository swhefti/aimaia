-- Migration 017: Create ticker_conclusions table
-- Stores AI-generated analysis conclusions per ticker per date.
-- The synthesis agent generates 3-5 sentence summaries based on all available data.
-- Previous conclusions are referenced when generating new ones for continuity.

CREATE TABLE IF NOT EXISTS ticker_conclusions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker          TEXT        NOT NULL REFERENCES assets(ticker),
  date            DATE        NOT NULL,
  conclusion      TEXT        NOT NULL,  -- 3-5 sentence AI-generated conclusion
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticker, date)
);

-- Index for fast lookups by ticker ordered by date
CREATE INDEX IF NOT EXISTS idx_ticker_conclusions_ticker_date
  ON ticker_conclusions (ticker, date DESC);

-- RLS: allow all authenticated users to read (conclusions are shared/global)
ALTER TABLE ticker_conclusions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ticker_conclusions_select_all"
  ON ticker_conclusions FOR SELECT
  USING (true);

-- Only service role can insert (via API route)
CREATE POLICY "ticker_conclusions_insert_service"
  ON ticker_conclusions FOR INSERT
  WITH CHECK (true);
