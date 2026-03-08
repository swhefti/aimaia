-- Migration 012: Create helper PostgreSQL functions
-- These are convenience functions used by the backend pipeline and analysis agents.

-- ---------------------------------------------------------------------------
-- get_latest_agent_scores(p_ticker, p_date)
-- Returns the most recent score for each agent type for a given ticker,
-- looking back up to 7 days from p_date to handle weekends / stale data.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_latest_agent_scores(
  p_ticker TEXT,
  p_date   DATE
)
RETURNS TABLE (
  ticker           TEXT,
  date             DATE,
  agent_type       agent_type_enum,
  score            NUMERIC,
  confidence       NUMERIC,
  component_scores JSONB,
  explanation      TEXT,
  data_freshness   data_freshness_enum,
  agent_version    TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (s.agent_type)
    s.ticker,
    s.date,
    s.agent_type,
    s.score,
    s.confidence,
    s.component_scores,
    s.explanation,
    s.data_freshness,
    s.agent_version
  FROM agent_scores s
  WHERE s.ticker     = p_ticker
    AND s.date      <= p_date
    AND s.date      >= p_date - INTERVAL '7 days'
  ORDER BY s.agent_type, s.date DESC;
$$;

-- ---------------------------------------------------------------------------
-- get_user_portfolio_state(p_user_id, p_date)
-- Returns open positions for a user's active portfolio with the latest
-- valuation and market price.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_portfolio_state(
  p_user_id UUID,
  p_date    DATE
)
RETURNS TABLE (
  portfolio_id       UUID,
  portfolio_name     TEXT,
  ticker             TEXT,
  quantity           NUMERIC,
  avg_purchase_price NUMERIC,
  opened_at          TIMESTAMPTZ,
  last_price         NUMERIC,
  total_value        NUMERIC,
  goal_probability_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p.id                           AS portfolio_id,
    p.name                         AS portfolio_name,
    pos.ticker,
    pos.quantity,
    pos.avg_purchase_price,
    pos.opened_at,
    mq.last_price,
    pos.quantity * mq.last_price   AS total_value,
    pv.goal_probability_pct
  FROM portfolios p
  JOIN portfolio_positions pos
    ON pos.portfolio_id = p.id
   AND pos.closed_at IS NULL
  LEFT JOIN LATERAL (
    SELECT last_price
    FROM market_quotes mq2
    WHERE mq2.ticker = pos.ticker
      AND mq2.date  <= p_date
    ORDER BY mq2.date DESC
    LIMIT 1
  ) mq ON TRUE
  LEFT JOIN LATERAL (
    SELECT goal_probability_pct
    FROM portfolio_valuations pv2
    WHERE pv2.portfolio_id = p.id
      AND pv2.date        <= p_date
    ORDER BY pv2.date DESC
    LIMIT 1
  ) pv ON TRUE
  WHERE p.user_id = p_user_id
    AND p.status  = 'active';
$$;

-- ---------------------------------------------------------------------------
-- get_top_scored_assets(p_date, p_asset_types, p_limit)
-- Returns top N assets by combined weighted score for a given date.
-- Uses DEFAULT_AGENT_WEIGHTS: technical=0.50, sentiment=0.25, fundamental=0.20, regime=0.05
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_top_scored_assets(
  p_date        DATE,
  p_asset_types TEXT[],
  p_limit       INTEGER DEFAULT 20
)
RETURNS TABLE (
  ticker         TEXT,
  asset_type     asset_type_enum,
  name           TEXT,
  combined_score NUMERIC,
  technical_score    NUMERIC,
  sentiment_score    NUMERIC,
  fundamental_score  NUMERIC,
  regime_score       NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    a.ticker,
    a.asset_type,
    a.name,
    ROUND(
      COALESCE(MAX(CASE WHEN s.agent_type = 'technical'     THEN s.score END), 0) * 0.50 +
      COALESCE(MAX(CASE WHEN s.agent_type = 'sentiment'     THEN s.score END), 0) * 0.25 +
      COALESCE(MAX(CASE WHEN s.agent_type = 'fundamental'   THEN s.score END), 0) * 0.20 +
      COALESCE(MAX(CASE WHEN s.agent_type = 'market_regime' THEN s.score END), 0) * 0.05,
    4)                                                        AS combined_score,
    MAX(CASE WHEN s.agent_type = 'technical'     THEN s.score END) AS technical_score,
    MAX(CASE WHEN s.agent_type = 'sentiment'     THEN s.score END) AS sentiment_score,
    MAX(CASE WHEN s.agent_type = 'fundamental'   THEN s.score END) AS fundamental_score,
    MAX(CASE WHEN s.agent_type = 'market_regime' THEN s.score END) AS regime_score
  FROM assets a
  JOIN agent_scores s ON s.ticker = a.ticker AND s.date = p_date
  WHERE a.active = TRUE
    AND (p_asset_types IS NULL OR a.asset_type::TEXT = ANY(p_asset_types))
  GROUP BY a.ticker, a.asset_type, a.name
  ORDER BY combined_score DESC
  LIMIT p_limit;
$$;
