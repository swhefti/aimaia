import type { SupabaseClient } from '@supabase/supabase-js';
import type { UserProfile, Portfolio, PortfolioPosition, PortfolioValuation } from '@shared/types/portfolio';
import type { RecommendationRun, RecommendationItem, UserDecisionValue } from '@shared/types/recommendations';
import type { AgentScore } from '@shared/types/scores';
import { ASSET_TYPE_MAP, getWeightsForTicker } from '@shared/lib/constants';

export interface PortfolioPositionWithScore extends PortfolioPosition {
  asset?: { name: string; asset_type: string } | undefined;
  latestScore?: number | undefined;
  latestAction?: string | undefined;
}

export interface SynthesisRawOutput {
  id: string;
  synthesisRunId: string;
  rawLlmOutput: Record<string, unknown>;
  postRulesOutput: Record<string, unknown>;
  overridesApplied: Record<string, unknown>[];
  lowConfidenceReasons: string[];
  createdAt: string;
}

// ---------- User Profile ----------

export async function getUserProfile(supabase: SupabaseClient, userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();
  if (error || !data) return null;
  return mapUserProfile(data);
}

export async function upsertUserProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: Omit<UserProfile, 'userId'>
): Promise<void> {
  // DB CHECK constraint on max_drawdown_limit_pct requires value > 1 (stored as percentage)
  // Frontend uses decimal (0.15 for 15%), so convert if needed
  const drawdownForDb = profile.maxDrawdownLimitPct <= 1
    ? profile.maxDrawdownLimitPct * 100
    : profile.maxDrawdownLimitPct;

  const { error } = await supabase.from('user_profiles').upsert(
    {
      user_id: userId,
      investment_capital: profile.investmentCapital,
      time_horizon_months: profile.timeHorizonMonths,
      risk_profile: profile.riskProfile,
      goal_return_pct: profile.goalReturnPct,
      max_drawdown_limit_pct: drawdownForDb,
      volatility_tolerance: profile.volatilityTolerance,
      asset_types: profile.assetTypes,
      max_positions: profile.maxPositions,
      rebalancing_preference: profile.rebalancingPreference ?? 'daily',
    },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

// ---------- Portfolio ----------

export async function getPortfolio(supabase: SupabaseClient, userId: string): Promise<Portfolio | null> {
  const { data, error } = await supabase
    .from('portfolios')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    userId: data.user_id,
    name: data.name,
    createdAt: data.created_at,
    status: data.status,
  };
}

export async function createPortfolio(
  supabase: SupabaseClient,
  userId: string,
  name: string
): Promise<string> {
  const { data, error } = await supabase
    .from('portfolios')
    .insert({ user_id: userId, name, status: 'active' })
    .select('id')
    .single();
  if (error || !data) throw error || new Error('Failed to create portfolio');
  return data.id;
}

// ---------- Portfolio Positions ----------

export async function getPortfolioPositions(
  supabase: SupabaseClient,
  portfolioId: string
): Promise<PortfolioPositionWithScore[]> {
  const { data, error } = await supabase
    .from('portfolio_positions')
    .select('*, assets(name, asset_type)')
    .eq('portfolio_id', portfolioId)
    .eq('is_active', true);
  if (error) throw error;
  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    portfolioId: row.portfolio_id as string,
    ticker: row.ticker as string,
    quantity: row.quantity as number,
    avgPurchasePrice: row.avg_purchase_price as number,
    openedAt: row.opened_at as string,
    asset: row.assets as { name: string; asset_type: string } | undefined,
  }));
}

export async function insertPortfolioPositions(
  supabase: SupabaseClient,
  portfolioId: string,
  positions: { ticker: string; quantity: number; avgPurchasePrice: number }[]
): Promise<void> {
  const rows = positions.map((p) => ({
    portfolio_id: portfolioId,
    ticker: p.ticker,
    quantity: p.quantity,
    avg_purchase_price: p.avgPurchasePrice,
  }));
  const { error } = await supabase.from('portfolio_positions').insert(rows);
  if (error) throw error;
}

// ---------- Valuations ----------

export async function getPortfolioValuations(
  supabase: SupabaseClient,
  portfolioId: string,
  days: number = 30
): Promise<PortfolioValuation[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const { data, error } = await supabase
    .from('portfolio_valuations')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: true });
  if (error) throw error;
  return (data || []).map((row: Record<string, unknown>) => ({
    portfolioId: row.portfolio_id as string,
    date: row.date as string,
    totalValue: row.total_value as number,
    cashValue: row.cash_value as number,
    dailyPnl: row.daily_pnl as number,
    cumulativeReturnPct: row.cumulative_return_pct as number,
    goalProbabilityPct: row.goal_probability_pct as number,
  }));
}

// ---------- Recommendations ----------

export async function getLatestRecommendationRun(
  supabase: SupabaseClient,
  portfolioId: string
): Promise<RecommendationRun | null> {
  const { data, error } = await supabase
    .from('recommendation_runs')
    .select('*')
    .eq('portfolio_id', portfolioId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();
  if (error || !data) return null;
  return mapRecommendationRun(data);
}

export async function getRecommendationItems(
  supabase: SupabaseClient,
  runId: string
): Promise<RecommendationItem[]> {
  const { data, error } = await supabase
    .from('recommendation_items')
    .select('*')
    .eq('run_id', runId)
    .order('priority', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapRecommendationItem);
}

// ---------- Agent Scores ----------

export async function getAgentScoresForTicker(
  supabase: SupabaseClient,
  ticker: string,
  date?: string,
  asOfDate?: string
): Promise<AgentScore[]> {
  let query = supabase
    .from('agent_scores')
    .select('*')
    .eq('ticker', ticker)
    .order('date', { ascending: false });
  if (date) {
    query = query.eq('date', date);
  } else if (asOfDate) {
    query = query.lte('date', asOfDate).limit(20);
  } else {
    query = query.limit(20);
  }
  const { data, error } = await query;
  if (error) throw error;
  const allScores = (data || []).map((row: Record<string, unknown>) => ({
    ticker: row.ticker as string,
    date: row.date as string,
    agentType: row.agent_type as AgentScore['agentType'],
    score: row.score as number,
    confidence: row.confidence as number,
    componentScores: (row.component_scores as Record<string, number>) || {},
    explanation: row.explanation as string,
    dataFreshness: row.data_freshness as AgentScore['dataFreshness'],
    agentVersion: row.agent_version as string,
  }));

  // Deduplicate by agentType — keep the most recent (first, since ordered by date desc)
  const seen = new Set<string>();
  const scores: typeof allScores = [];
  for (const s of allScores) {
    if (!seen.has(s.agentType)) {
      seen.add(s.agentType);
      scores.push(s);
    }
  }

  // Inject regime score if not already present
  if (!scores.some((s) => s.agentType === 'market_regime')) {
    const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
    const regimeTicker = isCrypto ? 'MARKET_CRYPTO' : 'MARKET';
    const scoreDate = scores[0]?.date;
    // Use lte (not eq) to find the most recent regime score on or before the ticker's score date
    let regimeQuery = supabase
      .from('agent_scores')
      .select('*')
      .eq('ticker', regimeTicker)
      .eq('agent_type', 'market_regime')
      .order('date', { ascending: false })
      .limit(1);
    if (scoreDate) {
      regimeQuery = regimeQuery.lte('date', scoreDate);
    } else if (asOfDate) {
      regimeQuery = regimeQuery.lte('date', asOfDate);
    }
    // Also try the stock market regime if crypto regime not found
    let { data: regimeData } = await regimeQuery;
    if ((!regimeData || regimeData.length === 0) && isCrypto) {
      // Fallback: try stock market regime for crypto tickers if MARKET_CRYPTO doesn't exist yet
      let fallbackQuery = supabase
        .from('agent_scores')
        .select('*')
        .eq('ticker', 'MARKET')
        .eq('agent_type', 'market_regime')
        .order('date', { ascending: false })
        .limit(1);
      if (scoreDate) {
        fallbackQuery = fallbackQuery.lte('date', scoreDate);
      } else if (asOfDate) {
        fallbackQuery = fallbackQuery.lte('date', asOfDate);
      }
      const fallback = await fallbackQuery;
      regimeData = fallback.data;
    }
    if (regimeData && regimeData.length > 0) {
      const r = regimeData[0]!;
      scores.push({
        ticker,
        date: r.date as string,
        agentType: 'market_regime',
        score: r.score as number,
        confidence: r.confidence as number,
        componentScores: (r.component_scores as Record<string, number>) || {},
        explanation: r.explanation as string,
        dataFreshness: r.data_freshness as AgentScore['dataFreshness'],
        agentVersion: r.agent_version as string,
      });
    }
  }

  return scores;
}

// ---------- Synthesis Raw Output ----------

export async function getSynthesisRawOutput(
  supabase: SupabaseClient,
  runId: string
): Promise<SynthesisRawOutput | null> {
  const { data, error } = await supabase
    .from('synthesis_raw_outputs')
    .select('*')
    .eq('synthesis_run_id', runId)
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    synthesisRunId: data.synthesis_run_id,
    rawLlmOutput: data.raw_llm_output,
    postRulesOutput: data.post_rules_output,
    overridesApplied: data.overrides_applied,
    lowConfidenceReasons: data.low_confidence_reasons || [],
    createdAt: data.created_at,
  };
}

// ---------- User Decisions ----------

export async function submitUserDecision(
  supabase: SupabaseClient,
  recommendationId: string,
  decision: UserDecisionValue,
  userId: string
): Promise<void> {
  const { error } = await supabase.from('user_decisions').insert({
    recommendation_id: recommendationId,
    user_id: userId,
    decision,
    decided_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function getDecidedRecommendationIds(
  supabase: SupabaseClient,
  userId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('user_decisions')
    .select('recommendation_id')
    .eq('user_id', userId);
  return new Set((data ?? []).map((r) => r.recommendation_id as string));
}

// ---------- Add / Remove Positions ----------

export async function addPortfolioPosition(
  supabase: SupabaseClient,
  portfolioId: string,
  ticker: string,
  quantity: number,
  avgPurchasePrice: number
): Promise<string> {
  const { data, error } = await supabase.from('portfolio_positions').insert({
    portfolio_id: portfolioId,
    ticker,
    quantity,
    avg_purchase_price: avgPurchasePrice,
  }).select('id').single();
  if (error || !data) throw error || new Error('Failed to add position');
  return data.id as string;
}

export async function updatePortfolioPosition(
  supabase: SupabaseClient,
  positionId: string,
  quantity: number,
  avgPurchasePrice: number
): Promise<void> {
  const { error } = await supabase
    .from('portfolio_positions')
    .update({ quantity, avg_purchase_price: avgPurchasePrice })
    .eq('id', positionId);
  if (error) throw error;
}

export async function removePortfolioPosition(
  supabase: SupabaseClient,
  positionId: string
): Promise<void> {
  const { error } = await supabase
    .from('portfolio_positions')
    .delete()
    .eq('id', positionId);
  if (error) throw error;
}

// ---------- Latest Prices ----------

export async function getLatestPrices(
  supabase: SupabaseClient,
  tickers: string[],
  asOfDate?: string
): Promise<Record<string, number>> {
  if (tickers.length === 0) return {};

  // When asOfDate is set (simulation), prefer price_history (daily OHLCV close prices)
  // which is more reliable for historical dates than market_quotes
  if (asOfDate) {
    const prices = await getPricesFromHistory(supabase, asOfDate, tickers);
    if (Object.keys(prices).length > 0) return prices;
  }

  let query = supabase
    .from('market_quotes')
    .select('ticker, last_price')
    .in('ticker', tickers)
    .order('date', { ascending: false });
  if (asOfDate) query = query.lte('date', asOfDate);

  const { data } = await query;
  const prices: Record<string, number> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!prices[t]) prices[t] = row.last_price as number;
  }
  return prices;
}

export async function getAllLatestPrices(
  supabase: SupabaseClient,
  asOfDate?: string
): Promise<Record<string, number>> {
  // When asOfDate is set (simulation), prefer price_history (daily OHLCV close prices)
  if (asOfDate) {
    const prices = await getPricesFromHistory(supabase, asOfDate);
    if (Object.keys(prices).length > 0) return prices;
  }

  let query = supabase
    .from('market_quotes')
    .select('ticker, last_price')
    .order('date', { ascending: false })
    .limit(2000);
  if (asOfDate) query = query.lte('date', asOfDate);

  const { data } = await query;
  const prices: Record<string, number> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!prices[t]) prices[t] = row.last_price as number;
  }
  return prices;
}

// Fetch close prices from price_history for a specific date (or most recent before it)
async function getPricesFromHistory(
  supabase: SupabaseClient,
  asOfDate: string,
  tickers?: string[]
): Promise<Record<string, number>> {
  // Try exact date first, then fall back to most recent before asOfDate
  let query = supabase
    .from('price_history')
    .select('ticker, close, date')
    .lte('date', asOfDate)
    .order('date', { ascending: false })
    .limit(2000);
  if (tickers && tickers.length > 0) {
    query = query.in('ticker', tickers);
  }

  const { data } = await query;
  const prices: Record<string, number> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    // Take the most recent date's close price per ticker
    if (!prices[t]) prices[t] = Number(row.close);
  }
  return prices;
}

// ---------- Market Last Updated ----------

export interface MarketFreshness {
  stocksUpdatedAt: string | null;
  cryptoUpdatedAt: string | null;
}

export async function getMarketLastUpdated(
  supabase: SupabaseClient,
  asOfDate?: string
): Promise<string | null> {
  const f = await getMarketFreshness(supabase, asOfDate);
  // Return the most recent of the two for backward compat
  if (f.stocksUpdatedAt && f.cryptoUpdatedAt) {
    return f.stocksUpdatedAt > f.cryptoUpdatedAt ? f.stocksUpdatedAt : f.cryptoUpdatedAt;
  }
  return f.stocksUpdatedAt ?? f.cryptoUpdatedAt;
}

export async function getMarketFreshness(
  supabase: SupabaseClient,
  asOfDate?: string
): Promise<MarketFreshness> {
  // Use representative tickers to check freshness per asset type
  const stockTickers = ['AAPL', 'MSFT', 'SPY'];
  const cryptoTickers = ['BTC', 'ETH'];

  let stockQuery = supabase
    .from('price_history')
    .select('ingested_at')
    .in('ticker', stockTickers)
    .order('ingested_at', { ascending: false })
    .limit(1);
  if (asOfDate) stockQuery = stockQuery.lte('date', asOfDate);

  let cryptoQuery = supabase
    .from('price_history')
    .select('ingested_at')
    .in('ticker', cryptoTickers)
    .order('ingested_at', { ascending: false })
    .limit(1);
  if (asOfDate) cryptoQuery = cryptoQuery.lte('date', asOfDate);

  const [{ data: stockData }, { data: cryptoData }] = await Promise.all([stockQuery, cryptoQuery]);

  return {
    stocksUpdatedAt: stockData?.[0]?.ingested_at as string | null ?? null,
    cryptoUpdatedAt: cryptoData?.[0]?.ingested_at as string | null ?? null,
  };
}

// ---------- All Agent Scores (latest) ----------

export async function getAllLatestScores(
  supabase: SupabaseClient,
  asOfDate?: string
): Promise<Record<string, number>> {
  // Find latest date with technical scores (full pipeline run)
  let dateQuery = supabase
    .from('agent_scores')
    .select('date')
    .eq('agent_type', 'technical')
    .order('date', { ascending: false })
    .limit(1);
  if (asOfDate) dateQuery = dateQuery.lte('date', asOfDate);

  const { data: latestRow } = await dateQuery;
  const latestDate = latestRow?.[0]?.date as string | undefined;
  if (!latestDate) return {};

  // Get base scores from full pipeline date
  const { data } = await supabase
    .from('agent_scores')
    .select('ticker, score, agent_type, date, confidence, data_freshness')
    .eq('date', latestDate)
    .limit(2000);

  // Get any newer scores (e.g., daily sentiment updates)
  let newerData: typeof data = [];
  const { data: newer } = await supabase
    .from('agent_scores')
    .select('ticker, score, agent_type, date, confidence, data_freshness')
    .gt('date', latestDate)
    .order('date', { ascending: false })
    .limit(2000);
  if (asOfDate && newer) {
    newerData = newer.filter((r) => (r.date as string) <= asOfDate);
  } else {
    newerData = newer ?? [];
  }

  // Merge: newer scores override base for same ticker+agent_type
  const bestByKey = new Map<string, { ticker: string; score: number; agent_type: string; date: string; confidence: number; data_freshness: string }>();
  for (const row of [...(data ?? []), ...(newerData ?? [])]) {
    const key = `${row.ticker}|${row.agent_type}`;
    const existing = bestByKey.get(key);
    if (!existing || (row.date as string) > (existing.date as string)) {
      bestByKey.set(key, {
        ticker: row.ticker as string,
        score: row.score as number,
        agent_type: row.agent_type as string,
        date: row.date as string,
        confidence: row.confidence as number,
        data_freshness: (row.data_freshness as string) ?? 'current',
      });
    }
  }

  // Group scores by ticker and agent type
  const scoresByTicker: Record<string, Record<string, { score: number; confidence: number; data_freshness: string }>> = {};
  for (const entry of bestByKey.values()) {
    if (!scoresByTicker[entry.ticker]) scoresByTicker[entry.ticker] = {};
    scoresByTicker[entry.ticker]![entry.agent_type] = { score: entry.score, confidence: entry.confidence, data_freshness: entry.data_freshness };
  }

  // Extract regime scores
  const stockRegimeScore = scoresByTicker['MARKET']?.['market_regime']?.score ?? 0;
  const cryptoRegimeScore = scoresByTicker['MARKET_CRYPTO']?.['market_regime']?.score ?? stockRegimeScore;
  delete scoresByTicker['MARKET'];
  delete scoresByTicker['MARKET_CRYPTO'];

  // Compute weighted composite per ticker
  const result: Record<string, number> = {};
  for (const [ticker, agentScores] of Object.entries(scoresByTicker)) {
    const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
    const sentEntry = agentScores['sentiment'];
    const sentimentMissing = isCrypto && (!sentEntry || sentEntry.confidence === 0 || sentEntry.data_freshness === 'missing');
    const w = getWeightsForTicker(ticker, sentimentMissing);
    const regime = isCrypto ? cryptoRegimeScore : stockRegimeScore;
    const tech = agentScores['technical']?.score ?? 0;
    const sent = sentEntry?.score ?? 0;
    const fund = agentScores['fundamental']?.score ?? 0;
    result[ticker] = tech * w.technical + sent * w.sentiment + fund * w.fundamental + regime * w.regime;
  }
  return result;
}

// ---------- Update Portfolio Valuation ----------

export async function upsertPortfolioValuation(
  supabase: SupabaseClient,
  portfolioId: string,
  totalValue: number,
  cashValue: number,
  dailyPnl: number,
  cumulativeReturnPct: number,
  goalProbabilityPct: number
): Promise<void> {
  const date = new Date().toISOString().split('T')[0]!;

  // Check if today's valuation exists
  const { data: existing } = await supabase
    .from('portfolio_valuations')
    .select('id')
    .eq('portfolio_id', portfolioId)
    .eq('date', date)
    .limit(1)
    .single();

  if (existing) {
    const { error } = await supabase
      .from('portfolio_valuations')
      .update({
        total_value: totalValue,
        cash_value: cashValue,
        daily_pnl: dailyPnl,
        cumulative_return_pct: cumulativeReturnPct,
        goal_probability_pct: goalProbabilityPct,
      })
      .eq('id', existing.id);
    if (error) console.error('Valuation update error:', error.message);
  } else {
    const { error } = await supabase.from('portfolio_valuations').insert({
      portfolio_id: portfolioId,
      date,
      total_value: totalValue,
      cash_value: cashValue,
      daily_pnl: dailyPnl,
      cumulative_return_pct: cumulativeReturnPct,
      goal_probability_pct: goalProbabilityPct,
    });
    if (error) console.error('Valuation insert error:', error.message);
  }
}

// ---------- Portfolio Reset ----------

export async function archivePortfolio(
  supabase: SupabaseClient,
  portfolioId: string
): Promise<void> {
  const { error } = await supabase
    .from('portfolios')
    .update({ status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', portfolioId);
  if (error) throw error;
}

export async function deleteUserProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { error } = await supabase
    .from('user_profiles')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}

// ---------- Ticker Detail Data ----------

export interface TickerQuote {
  ticker: string;
  date: string;
  lastPrice: number;
  dailyChange: number;
  pctChange: number;
}

export interface TickerFundamental {
  ticker: string;
  date: string;
  peRatio: number | null;
  psRatio: number | null;
  revenueGrowthYoy: number | null;
  profitMargin: number | null;
  roe: number | null;
  marketCap: number | null;
  debtToEquity: number | null;
}

export interface TickerNewsItem {
  id: string;
  ticker: string;
  headline: string;
  summary: string | null;
  source: string;
  publishedAt: string;
  url: string;
}

export async function getTickerQuote(
  supabase: SupabaseClient,
  ticker: string,
  asOfDate?: string
): Promise<TickerQuote | null> {
  let query = supabase
    .from('market_quotes')
    .select('*')
    .eq('ticker', ticker)
    .order('date', { ascending: false })
    .limit(1);
  if (asOfDate) query = query.lte('date', asOfDate);

  const { data, error } = await query.single();
  if (error || !data) return null;
  return {
    ticker: data.ticker,
    date: data.date,
    lastPrice: Number(data.last_price),
    dailyChange: Number(data.daily_change),
    pctChange: Number(data.pct_change),
  };
}

export async function getTickerFundamentals(
  supabase: SupabaseClient,
  ticker: string,
  asOfDate?: string
): Promise<TickerFundamental | null> {
  let query = supabase
    .from('fundamental_data')
    .select('*')
    .eq('ticker', ticker)
    .order('date', { ascending: false })
    .limit(1);
  if (asOfDate) query = query.lte('date', asOfDate);

  const { data, error } = await query.single();
  if (error || !data) return null;
  return {
    ticker: data.ticker,
    date: data.date,
    peRatio: data.pe_ratio != null ? Number(data.pe_ratio) : null,
    psRatio: data.ps_ratio != null ? Number(data.ps_ratio) : null,
    revenueGrowthYoy: data.revenue_growth_yoy != null ? Number(data.revenue_growth_yoy) : null,
    profitMargin: data.profit_margin != null ? Number(data.profit_margin) : null,
    roe: data.roe != null ? Number(data.roe) : null,
    marketCap: data.market_cap != null ? Number(data.market_cap) : null,
    debtToEquity: data.debt_to_equity != null ? Number(data.debt_to_equity) : null,
  };
}

export async function getAllMarketCaps(
  supabase: SupabaseClient,
  asOfDate?: string
): Promise<Record<string, number>> {
  let query = supabase
    .from('fundamental_data')
    .select('ticker, market_cap, date')
    .not('market_cap', 'is', null)
    .order('date', { ascending: false })
    .limit(2000);
  if (asOfDate) query = query.lte('date', asOfDate);

  const { data } = await query;
  const caps: Record<string, number> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!caps[t] && row.market_cap != null) caps[t] = Number(row.market_cap);
  }
  return caps;
}

export async function getTickerNews(
  supabase: SupabaseClient,
  ticker: string,
  limit = 10,
  asOfDate?: string
): Promise<TickerNewsItem[]> {
  let query = supabase
    .from('news_data')
    .select('*')
    .eq('ticker', ticker)
    .order('published_at', { ascending: false })
    .limit(limit);
  if (asOfDate) query = query.lte('published_at', asOfDate + 'T23:59:59');

  const { data, error } = await query;
  if (error) return [];
  return (data || []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    ticker: row.ticker as string,
    headline: row.headline as string,
    summary: (row.summary as string) || null,
    source: row.source as string,
    publishedAt: row.published_at as string,
    url: row.url as string,
  }));
}

export async function getAllAgentScoresGrouped(
  supabase: SupabaseClient,
  asOfDate?: string
): Promise<Record<string, AgentScore[]>> {
  // Find the latest date that has technical scores (full pipeline run)
  let dateQuery = supabase
    .from('agent_scores')
    .select('date')
    .eq('agent_type', 'technical')
    .order('date', { ascending: false })
    .limit(1);
  if (asOfDate) dateQuery = dateQuery.lte('date', asOfDate);

  const { data: latestRow } = await dateQuery;
  let baseDate = latestRow?.[0]?.date as string | undefined;
  if (!baseDate) {
    // Fallback: any scores at all
    let fallbackQuery = supabase
      .from('agent_scores')
      .select('date')
      .order('date', { ascending: false })
      .limit(1);
    if (asOfDate) fallbackQuery = fallbackQuery.lte('date', asOfDate);
    const { data: fb } = await fallbackQuery;
    baseDate = fb?.[0]?.date as string | undefined;
    if (!baseDate) return {};
  }

  // Get all scores from the base date (full pipeline)
  const { data } = await supabase
    .from('agent_scores')
    .select('*')
    .eq('date', baseDate)
    .limit(2000);

  // Also get any newer scores (e.g., sentiment updates after the last full pipeline run)
  let newerScores: typeof data = [];
  if (baseDate) {
    const { data: newer } = await supabase
      .from('agent_scores')
      .select('*')
      .gt('date', baseDate)
      .order('date', { ascending: false })
      .limit(2000);
    if (asOfDate && newer) {
      newerScores = newer.filter((r) => (r.date as string) <= asOfDate);
    } else {
      newerScores = newer ?? [];
    }
  }

  // Combine base + newer scores; newer scores override base for same ticker+agent_type
  const allRows = [...(data ?? []), ...(newerScores ?? [])];

  // Deduplicate: keep the most recent score per ticker+agent_type
  const bestByKey = new Map<string, (typeof allRows)[0]>();
  for (const row of allRows) {
    const key = `${row.ticker}|${row.agent_type}`;
    const existing = bestByKey.get(key);
    if (!existing || (row.date as string) > (existing.date as string)) {
      bestByKey.set(key, row);
    }
  }

  const grouped: Record<string, AgentScore[]> = {};
  for (const row of bestByKey.values()) {
    const ticker = row.ticker as string;
    if (!grouped[ticker]) grouped[ticker] = [];
    grouped[ticker].push({
      ticker,
      date: row.date as string,
      agentType: row.agent_type as AgentScore['agentType'],
      score: Number(row.score),
      confidence: Number(row.confidence),
      componentScores: (row.component_scores as Record<string, number>) || {},
      explanation: (row.explanation as string) || '',
      dataFreshness: row.data_freshness as AgentScore['dataFreshness'],
      agentVersion: row.agent_version as string,
    });
  }

  // Inject regime scores into each real ticker's score array
  const stockRegime = grouped['MARKET']?.[0];
  const cryptoRegime = grouped['MARKET_CRYPTO']?.[0];
  delete grouped['MARKET'];
  delete grouped['MARKET_CRYPTO'];

  if (stockRegime || cryptoRegime) {
    for (const [ticker, scores] of Object.entries(grouped)) {
      // Skip if this ticker already has a regime score
      if (scores.some((s) => s.agentType === 'market_regime')) continue;
      const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
      const regime = isCrypto ? (cryptoRegime ?? stockRegime) : stockRegime;
      if (regime) {
        scores.push({
          ...regime,
          ticker, // override ticker to match the asset
        });
      }
    }
  }

  return grouped;
}

export async function getAllQuotes(
  supabase: SupabaseClient,
  asOfDate?: string
): Promise<Record<string, TickerQuote>> {
  // For simulation, build quotes from price_history (close prices for two consecutive days)
  if (asOfDate) {
    const quotes = await getQuotesFromHistory(supabase, asOfDate);
    if (Object.keys(quotes).length > 0) return quotes;
  }

  let query = supabase
    .from('market_quotes')
    .select('*')
    .order('date', { ascending: false })
    .limit(2000);
  if (asOfDate) query = query.lte('date', asOfDate);

  const { data } = await query;
  const quotes: Record<string, TickerQuote> = {};
  for (const row of data ?? []) {
    const ticker = row.ticker as string;
    if (!quotes[ticker]) {
      quotes[ticker] = {
        ticker,
        date: row.date as string,
        lastPrice: Number(row.last_price),
        dailyChange: Number(row.daily_change),
        pctChange: Number(row.pct_change),
      };
    }
  }
  return quotes;
}

// Build quote-like objects from price_history for simulation
async function getQuotesFromHistory(
  supabase: SupabaseClient,
  asOfDate: string
): Promise<Record<string, TickerQuote>> {
  // Get the two most recent days of data up to asOfDate per ticker
  const { data } = await supabase
    .from('price_history')
    .select('ticker, close, date')
    .lte('date', asOfDate)
    .order('date', { ascending: false })
    .limit(4000); // enough for 2 days × ~100 tickers with margin

  if (!data || data.length === 0) return {};

  // Group by ticker, take the two most recent dates
  const byTicker: Record<string, { close: number; date: string }[]> = {};
  for (const row of data) {
    const t = row.ticker as string;
    if (!byTicker[t]) byTicker[t] = [];
    if (byTicker[t].length < 2) {
      byTicker[t].push({ close: Number(row.close), date: row.date as string });
    }
  }

  const quotes: Record<string, TickerQuote> = {};
  for (const [ticker, rows] of Object.entries(byTicker)) {
    const today = rows[0]!;
    const prev = rows[1];
    const dailyChange = prev ? today.close - prev.close : 0;
    const pctChange = prev && prev.close !== 0 ? dailyChange / prev.close : 0;
    quotes[ticker] = {
      ticker,
      date: today.date,
      lastPrice: today.close,
      dailyChange,
      pctChange,
    };
  }
  return quotes;
}

// ---------- Mappers ----------

function mapUserProfile(row: Record<string, unknown>): UserProfile {
  // DB stores max_drawdown_limit_pct as percentage integer (15 for 15%)
  // Frontend expects decimal (0.15 for 15%), so normalize
  const rawDrawdown = row.max_drawdown_limit_pct as number;
  const drawdownPct = rawDrawdown > 1 ? rawDrawdown / 100 : rawDrawdown;

  return {
    userId: row.user_id as string,
    investmentCapital: row.investment_capital as number,
    timeHorizonMonths: row.time_horizon_months as number,
    riskProfile: row.risk_profile as UserProfile['riskProfile'],
    goalReturnPct: row.goal_return_pct as number,
    maxDrawdownLimitPct: drawdownPct,
    volatilityTolerance: row.volatility_tolerance as UserProfile['volatilityTolerance'],
    assetTypes: row.asset_types as UserProfile['assetTypes'],
    maxPositions: row.max_positions as number,
    rebalancingPreference: (row.rebalancing_preference as UserProfile['rebalancingPreference']) ?? 'daily',
  };
}

function mapRecommendationRun(row: Record<string, unknown>): RecommendationRun {
  return {
    id: row.id as string,
    portfolioId: row.portfolio_id as string,
    runDate: row.run_date as string,
    synthesisRunId: row.synthesis_run_id as string,
    overallConfidence: row.overall_confidence as number,
    goalStatus: row.goal_status as RecommendationRun['goalStatus'],
    portfolioNarrative: row.portfolio_narrative as string,
    weightRationale: row.weight_rationale as RecommendationRun['weightRationale'],
    generatedAt: row.generated_at as string,
  };
}

function mapRecommendationItem(row: Record<string, unknown>): RecommendationItem {
  return {
    id: row.id as string,
    runId: row.run_id as string,
    ticker: row.ticker as string,
    action: row.action as RecommendationItem['action'],
    urgency: row.urgency as RecommendationItem['urgency'],
    currentAllocationPct: row.current_allocation_pct as number,
    targetAllocationPct: row.target_allocation_pct as number,
    llmReasoning: row.llm_reasoning as string,
    confidence: row.confidence as number,
    rulesEngineApplied: row.rules_engine_applied as boolean,
    rulesEngineNote: row.rules_engine_note as string | null,
    priority: row.priority as number,
  };
}

// ---------- Ticker Conclusions ----------

export interface TickerConclusion {
  ticker: string;
  date: string;
  conclusion: string;
}

export async function getTickerConclusion(
  supabase: SupabaseClient,
  ticker: string,
  asOfDate?: string
): Promise<TickerConclusion | null> {
  let query = supabase
    .from('ticker_conclusions')
    .select('ticker, date, conclusion')
    .eq('ticker', ticker)
    .order('date', { ascending: false })
    .limit(1);
  if (asOfDate) query = query.lte('date', asOfDate);

  const { data, error } = await query.single();
  if (error || !data) return null;
  return {
    ticker: data.ticker as string,
    date: data.date as string,
    conclusion: data.conclusion as string,
  };
}
