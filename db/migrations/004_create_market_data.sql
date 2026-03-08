-- Migration 004: Create market data tables
-- price_history: daily OHLCV data from Twelve Data
-- market_quotes: latest daily quote snapshot
-- Both are INSERT-only (immutable). Composite PK prevents duplicate daily records.

CREATE TABLE IF NOT EXISTS price_history (
  ticker       TEXT        NOT NULL REFERENCES assets(ticker),
  date         DATE        NOT NULL,
  open         NUMERIC     NOT NULL,
  high         NUMERIC     NOT NULL,
  low          NUMERIC     NOT NULL,
  close        NUMERIC     NOT NULL,
  volume       NUMERIC     NOT NULL,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, date)
);

CREATE TABLE IF NOT EXISTS market_quotes (
  ticker       TEXT        NOT NULL REFERENCES assets(ticker),
  date         DATE        NOT NULL,
  last_price   NUMERIC     NOT NULL,
  daily_change NUMERIC     NOT NULL,  -- absolute USD change
  pct_change   NUMERIC     NOT NULL,  -- decimal, e.g. 0.02 for +2%
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, date)
);
