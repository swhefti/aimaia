-- Track actual cash balance on the portfolio to avoid deriving it from cost basis.
-- This fixes realized gains being lost when selling appreciated positions.
alter table portfolios add column if not exists cash_balance numeric default null;
