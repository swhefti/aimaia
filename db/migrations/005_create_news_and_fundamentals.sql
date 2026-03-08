-- Migration 005: Create news_data and fundamental_data tables
-- news_data: article headlines and summaries from Finnhub
-- fundamental_data: company financials from Finnhub (quarterly/annual)

CREATE TABLE IF NOT EXISTS news_data (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker       TEXT        NOT NULL REFERENCES assets(ticker),
  headline     TEXT        NOT NULL,
  summary      TEXT,                   -- may be NULL if provider doesn't supply it
  source       TEXT        NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  url          TEXT        NOT NULL UNIQUE,
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fundamental_data (
  ticker              TEXT        NOT NULL REFERENCES assets(ticker),
  date                DATE        NOT NULL,  -- report/snapshot date
  pe_ratio            NUMERIC,               -- NULL if not applicable (e.g. loss-making, ETF, crypto)
  ps_ratio            NUMERIC,
  revenue_growth_yoy  NUMERIC,               -- decimal, e.g. 0.15 for +15%
  profit_margin       NUMERIC,               -- decimal, e.g. 0.22 for 22%
  roe                 NUMERIC,               -- return on equity, decimal
  market_cap          NUMERIC,               -- USD
  debt_to_equity      NUMERIC,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ticker, date)
);
