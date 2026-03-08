-- Fix missing RLS policies that cause silent failures on UPDATE/DELETE

-- portfolio_valuations: add UPDATE policy (upsertPortfolioValuation does UPDATE for same-day)
DROP POLICY IF EXISTS "portfolio_valuations: owner update" ON portfolio_valuations;

CREATE POLICY "portfolio_valuations: owner update"
  ON portfolio_valuations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );

-- portfolio_positions: add DELETE policy (removePortfolioPosition does DELETE)
DROP POLICY IF EXISTS "portfolio_positions: owner delete" ON portfolio_positions;

CREATE POLICY "portfolio_positions: owner delete"
  ON portfolio_positions FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM portfolios p
      WHERE p.id = portfolio_id AND p.user_id = auth.uid()
    )
  );
