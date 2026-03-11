-- Enable RLS on all flagged tables
alter table public.assets enable row level security;
alter table public.price_history enable row level security;
alter table public.market_quotes enable row level security;
alter table public.news_data enable row level security;
alter table public.fundamental_data enable row level security;
alter table public.agent_scores enable row level security;
alter table public.macro_events enable row level security;

-- Allow anyone (anon + authenticated) to read all rows
-- These are public market data tables with no personal information
create policy "Public read access" on public.assets
  for select using (true);

create policy "Public read access" on public.price_history
  for select using (true);

create policy "Public read access" on public.market_quotes
  for select using (true);

create policy "Public read access" on public.news_data
  for select using (true);

create policy "Public read access" on public.fundamental_data
  for select using (true);

create policy "Public read access" on public.agent_scores
  for select using (true);

create policy "Public read access" on public.macro_events
  for select using (true);

-- Write access only via service role (used by cron routes and API routes)
-- No insert/update/delete policies needed for anon or authenticated roles
-- Service role bypasses RLS entirely by design
