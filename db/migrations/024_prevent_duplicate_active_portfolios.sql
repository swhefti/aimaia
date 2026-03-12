-- Migration 024: Prevent duplicate active portfolios per user
-- Root cause: race conditions in onboarding + dashboard could create >1 active portfolio.
-- This migration:
--   1. Archives empty duplicate active portfolios (keeps the one with positions)
--   2. Adds a unique partial index so only one active portfolio per user is allowed

-- Step 1: Archive empty duplicates.
-- For each user with >1 active portfolio, keep the one that has positions (or the oldest)
-- and archive the rest.
UPDATE portfolios
SET status = 'archived', updated_at = NOW()
WHERE id IN (
  SELECT p.id
  FROM portfolios p
  LEFT JOIN portfolio_positions pp ON pp.portfolio_id = p.id
  WHERE p.status = 'active'
    AND p.user_id IN (
      -- Users with more than one active portfolio
      SELECT user_id FROM portfolios WHERE status = 'active' GROUP BY user_id HAVING COUNT(*) > 1
    )
    AND NOT EXISTS (
      -- Keep portfolios that have at least one position
      SELECT 1 FROM portfolio_positions pp2 WHERE pp2.portfolio_id = p.id
    )
    -- Don't archive the oldest one if ALL portfolios are empty
    AND p.id != (
      SELECT p2.id FROM portfolios p2
      WHERE p2.user_id = p.user_id AND p2.status = 'active'
      ORDER BY p2.created_at ASC
      LIMIT 1
    )
);

-- Step 2: If a user STILL has >1 active portfolio (all had positions),
-- keep the one with the most positions and archive the rest.
UPDATE portfolios
SET status = 'archived', updated_at = NOW()
WHERE id IN (
  SELECT p.id
  FROM portfolios p
  WHERE p.status = 'active'
    AND p.user_id IN (
      SELECT user_id FROM portfolios WHERE status = 'active' GROUP BY user_id HAVING COUNT(*) > 1
    )
    AND p.id != (
      -- Keep the portfolio with the most positions
      SELECT p2.id FROM portfolios p2
      LEFT JOIN portfolio_positions pp ON pp.portfolio_id = p2.id
      WHERE p2.user_id = p.user_id AND p2.status = 'active'
      GROUP BY p2.id
      ORDER BY COUNT(pp.id) DESC, p2.created_at ASC
      LIMIT 1
    )
);

-- Step 3: Add unique partial index — only one active portfolio per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_portfolio_per_user
  ON portfolios (user_id)
  WHERE status = 'active';
