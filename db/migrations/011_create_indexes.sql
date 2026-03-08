-- Migration 011: Create performance indexes
-- All indexes are created with IF NOT EXISTS to stay idempotent.

-- price_history: most common access pattern is latest N days for a ticker
CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date
  ON price_history (ticker, date DESC);

-- market_quotes: same pattern
CREATE INDEX IF NOT EXISTS idx_market_quotes_ticker_date
  ON market_quotes (ticker, date DESC);

-- agent_scores: two access patterns
--   1. latest score for a ticker (per-asset lookups)
--   2. all scores for a date + agent type (synthesis assembly)
CREATE INDEX IF NOT EXISTS idx_agent_scores_ticker_date
  ON agent_scores (ticker, date DESC);

CREATE INDEX IF NOT EXISTS idx_agent_scores_date_agent_type
  ON agent_scores (date, agent_type);

-- news_data: recent news for a ticker (Sentiment Agent)
CREATE INDEX IF NOT EXISTS idx_news_data_ticker_published_at
  ON news_data (ticker, published_at DESC);

-- fundamental_data: recent fundamentals for a ticker
CREATE INDEX IF NOT EXISTS idx_fundamental_data_ticker_date
  ON fundamental_data (ticker, date DESC);

-- macro_events: by date for daily assembly
CREATE INDEX IF NOT EXISTS idx_macro_events_date
  ON macro_events (date DESC);

-- portfolios: list a user's portfolios
CREATE INDEX IF NOT EXISTS idx_portfolios_user_id
  ON portfolios (user_id);

-- portfolio_positions: list positions within a portfolio
CREATE INDEX IF NOT EXISTS idx_portfolio_positions_portfolio_id
  ON portfolio_positions (portfolio_id);

-- portfolio_valuations: recent valuations for a portfolio
CREATE INDEX IF NOT EXISTS idx_portfolio_valuations_portfolio_date
  ON portfolio_valuations (portfolio_id, date DESC);

-- portfolio_risk_metrics: recent risk metrics for a portfolio
CREATE INDEX IF NOT EXISTS idx_portfolio_risk_metrics_portfolio_date
  ON portfolio_risk_metrics (portfolio_id, date DESC);

-- recommendation_runs: most recent run for a portfolio
CREATE INDEX IF NOT EXISTS idx_recommendation_runs_portfolio_date
  ON recommendation_runs (portfolio_id, run_date DESC);

-- recommendation_items: all items within a run
CREATE INDEX IF NOT EXISTS idx_recommendation_items_run_id
  ON recommendation_items (run_id);

-- synthesis_runs: user synthesis history
CREATE INDEX IF NOT EXISTS idx_synthesis_runs_user_date
  ON synthesis_runs (user_id, run_date DESC);

-- synthesis_inputs: user input history
CREATE INDEX IF NOT EXISTS idx_synthesis_inputs_user_date
  ON synthesis_inputs (user_id, run_date DESC);

-- user_decisions: decisions linked to a recommendation item
CREATE INDEX IF NOT EXISTS idx_user_decisions_recommendation_id
  ON user_decisions (recommendation_id);
