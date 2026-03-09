import type {
  SynthesisContextPackage,
  AssetScoreContext,
  PortfolioPositionContext,
  MacroEventContext,
} from '../../shared/types/synthesis.js';
import type { UserProfile } from '../../shared/types/portfolio.js';
import { createSupabaseClient } from '../../shared/lib/supabase.js';
import { ASSET_TYPE_MAP } from '../../shared/lib/constants.js';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function buildContextPackage(
  userId: string,
  portfolioId: string,
  date: Date
): Promise<SynthesisContextPackage> {
  const supabase = createSupabaseClient();
  const dateStr = date.toISOString().split('T')[0]!;

  // 1. Load user profile
  const { data: profileData, error: profileError } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (profileError || !profileData) {
    throw new Error(`Failed to load user profile for ${userId}: ${profileError?.message}`);
  }

  const profile: UserProfile = {
    userId: profileData.user_id as string,
    investmentCapital: Number(profileData.investment_capital),
    timeHorizonMonths: Number(profileData.time_horizon_months),
    riskProfile: profileData.risk_profile as UserProfile['riskProfile'],
    goalReturnPct: Number(profileData.goal_return_pct),
    maxDrawdownLimitPct: Number(profileData.max_drawdown_limit_pct),
    volatilityTolerance: profileData.volatility_tolerance as UserProfile['volatilityTolerance'],
    assetTypes: profileData.asset_types as UserProfile['assetTypes'],
    maxPositions: Number(profileData.max_positions),
    rebalancingPreference: (profileData.rebalancing_preference as UserProfile['rebalancingPreference']) ?? 'daily',
  };

  // 2. Load portfolio positions with current prices
  const { data: positions } = await supabase
    .from('portfolio_positions')
    .select('ticker, quantity, avg_purchase_price')
    .eq('portfolio_id', portfolioId);

  // 3. Load latest valuation
  const { data: valuation } = await supabase
    .from('portfolio_valuations')
    .select('total_value, cash_value, goal_probability_pct')
    .eq('portfolio_id', portfolioId)
    .lte('date', dateStr)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  // Load valuation from 2 weeks ago for trend
  const twoWeeksAgo = new Date(date);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const twoWeeksAgoStr = twoWeeksAgo.toISOString().split('T')[0]!;

  const { data: prevValuation } = await supabase
    .from('portfolio_valuations')
    .select('goal_probability_pct')
    .eq('portfolio_id', portfolioId)
    .lte('date', twoWeeksAgoStr)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  const totalValue = valuation ? Number(valuation.total_value) : profile.investmentCapital;
  const cashValue = valuation ? Number(valuation.cash_value) : totalValue;
  const goalProbPct = valuation ? Number(valuation.goal_probability_pct) : 50;
  const prevGoalProbPct = prevValuation ? Number(prevValuation.goal_probability_pct) : goalProbPct;

  let goalProbabilityTrend: 'improving' | 'stable' | 'declining';
  const probDiff = goalProbPct - prevGoalProbPct;
  if (probDiff > 3) goalProbabilityTrend = 'improving';
  else if (probDiff < -3) goalProbabilityTrend = 'declining';
  else goalProbabilityTrend = 'stable';

  // Build position contexts with P&L
  const positionContexts: PortfolioPositionContext[] = [];
  const positionTickers: string[] = [];

  if (positions && positions.length > 0) {
    for (const pos of positions) {
      const ticker = pos.ticker as string;
      positionTickers.push(ticker);
      const qty = Number(pos.quantity);
      const avgPrice = Number(pos.avg_purchase_price);

      // Get current price
      const { data: latestPrice } = await supabase
        .from('price_history')
        .select('close')
        .eq('ticker', ticker)
        .lte('date', dateStr)
        .order('date', { ascending: false })
        .limit(1)
        .single();

      const currentPrice = latestPrice ? Number(latestPrice.close) : avgPrice;
      const currentValue = qty * currentPrice;
      const allocationPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;
      const unrealizedPnlPct = avgPrice > 0 ? (currentPrice - avgPrice) / avgPrice : 0;

      positionContexts.push({
        ticker,
        currentAllocationPct: Math.round(allocationPct * 100) / 100,
        currentValue,
        unrealizedPnlPct: Math.round(unrealizedPnlPct * 10000) / 10000,
      });
    }
  }

  // 4. Calculate concentration risk
  const allocations = positionContexts.map((p) => p.currentAllocationPct / 100);
  const hhi = allocations.reduce((sum, a) => sum + a * a, 0);
  const concentrationRisk = clamp(hhi * 2, 0, 1); // Scale HHI for readability

  // 5. Load agent scores for portfolio positions
  const allScoreTickers = [...positionTickers];

  // 6. Load top 5 non-owned assets by combined score
  const { data: topScores } = await supabase
    .from('agent_scores')
    .select('ticker, score')
    .eq('date', dateStr)
    .eq('agent_type', 'technical')
    .not('ticker', 'in', `(${positionTickers.length > 0 ? positionTickers.join(',') : 'NONE'})`)
    .order('score', { ascending: false })
    .limit(20);

  if (topScores) {
    const candidateTickers = topScores
      .filter((s) => {
        const type = ASSET_TYPE_MAP[s.ticker as string];
        return type && profile.assetTypes.includes(type);
      })
      .slice(0, 5)
      .map((s) => s.ticker as string);
    allScoreTickers.push(...candidateTickers);
  }

  // Also check for assets with score delta > 0.3
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0]!;

  const { data: todayScores } = await supabase
    .from('agent_scores')
    .select('ticker, score')
    .eq('date', dateStr)
    .eq('agent_type', 'technical');

  const { data: yesterdayScores } = await supabase
    .from('agent_scores')
    .select('ticker, score')
    .eq('date', yesterdayStr)
    .eq('agent_type', 'technical');

  if (todayScores && yesterdayScores) {
    const yesterdayMap = new Map(yesterdayScores.map((s) => [s.ticker as string, Number(s.score)]));
    for (const ts of todayScores) {
      const ticker = ts.ticker as string;
      const prevScore = yesterdayMap.get(ticker);
      if (prevScore !== undefined && Math.abs(Number(ts.score) - prevScore) > 0.3) {
        if (!allScoreTickers.includes(ticker)) {
          allScoreTickers.push(ticker);
        }
      }
    }
  }

  // 7. Load all agent scores for selected tickers
  const { data: allAgentScores } = await supabase
    .from('agent_scores')
    .select('ticker, agent_type, score, confidence, data_freshness')
    .eq('date', dateStr)
    .in('ticker', allScoreTickers.length > 0 ? allScoreTickers : ['NONE']);

  // Load both stock and crypto regime scores
  const { data: regimeRows } = await supabase
    .from('agent_scores')
    .select('ticker, score, confidence, component_scores')
    .in('ticker', ['MARKET', 'MARKET_CRYPTO'])
    .eq('agent_type', 'market_regime')
    .eq('date', dateStr);

  const stockRegimeData = regimeRows?.find((r) => r.ticker === 'MARKET') ?? null;
  const cryptoRegimeData = regimeRows?.find((r) => r.ticker === 'MARKET_CRYPTO') ?? null;
  // Backward compat: use stock regime as default
  const regimeData = stockRegimeData;

  // Build asset score contexts
  const scoresByTicker = new Map<string, Partial<AssetScoreContext>>();
  if (allAgentScores) {
    for (const s of allAgentScores) {
      const ticker = s.ticker as string;
      if (!scoresByTicker.has(ticker)) {
        // Use crypto regime for crypto tickers, stock regime for everything else
        const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';
        const applicableRegime = isCrypto ? (cryptoRegimeData ?? regimeData) : regimeData;
        scoresByTicker.set(ticker, {
          ticker,
          technicalScore: 0,
          sentimentScore: 0,
          fundamentalScore: 0,
          regimeScore: applicableRegime ? Number(applicableRegime.score) : 0,
          technicalConfidence: 0,
          sentimentConfidence: 0,
          fundamentalConfidence: 0,
          regimeConfidence: applicableRegime ? Number(applicableRegime.confidence) : 0,
          dataFreshness: 'current',
        });
      }
      const entry = scoresByTicker.get(ticker)!;
      const agentType = s.agent_type as string;
      const score = Number(s.score);
      const confidence = Number(s.confidence);
      const freshness = s.data_freshness as 'current' | 'stale' | 'missing';

      if (agentType === 'technical') {
        entry.technicalScore = score;
        entry.technicalConfidence = confidence;
      } else if (agentType === 'sentiment') {
        entry.sentimentScore = score;
        entry.sentimentConfidence = confidence;
      } else if (agentType === 'fundamental') {
        entry.fundamentalScore = score;
        entry.fundamentalConfidence = confidence;
      }

      if (freshness === 'missing' || (freshness === 'stale' && entry.dataFreshness !== 'missing')) {
        entry.dataFreshness = freshness;
      }
    }
  }

  const assetScores: AssetScoreContext[] = Array.from(scoresByTicker.values()) as AssetScoreContext[];

  // 8. Load macro events (last 24h)
  const macroStart = new Date(date);
  macroStart.setDate(macroStart.getDate() - 1);
  const macroStartStr = macroStart.toISOString().split('T')[0]!;

  const { data: macroData } = await supabase
    .from('macro_events')
    .select('date, event_description, event_type, sentiment, relevant_asset_types')
    .gte('date', macroStartStr)
    .lte('date', dateStr)
    .order('date', { ascending: false })
    .limit(10);

  const macroEvents: MacroEventContext[] = (macroData ?? []).map((e) => ({
    date: e.date as string,
    eventDescription: e.event_description as string,
    eventType: e.event_type as string,
    sentiment: Number(e.sentiment),
    relevantAssetTypes: ((e.relevant_asset_types as string[]) ?? []) as import('../../shared/types/assets.js').AssetType[],
  }));

  // 9. Build regime context from component_scores
  const regimeComponents = regimeData?.component_scores as Record<string, string | number> | null;

  const contextPackage: SynthesisContextPackage = {
    userContext: {
      goalReturnPct: profile.goalReturnPct,
      timeHorizonMonths: profile.timeHorizonMonths,
      riskProfile: profile.riskProfile,
      maxDrawdownLimitPct: profile.maxDrawdownLimitPct,
      volatilityTolerance: profile.volatilityTolerance,
      assetTypePreference: profile.assetTypes,
      maxPositions: profile.maxPositions,
    },
    portfolioState: {
      totalValueUsd: totalValue,
      goalProbabilityPct: goalProbPct,
      goalProbabilityTrend,
      cashAllocationPct: totalValue > 0 ? (cashValue / totalValue) * 100 : 100,
      concentrationRisk,
      positions: positionContexts,
    },
    assetScores,
    marketRegime: {
      regimeLabel: (regimeComponents?.['regimeLabel'] as SynthesisContextPackage['marketRegime']['regimeLabel']) ?? 'neutral',
      volatilityLevel: (regimeComponents?.['volatilityLevel'] as SynthesisContextPackage['marketRegime']['volatilityLevel']) ?? 'moderate',
      broadTrend: mapBroadTrend(regimeComponents?.['broadTrend'] as string | undefined),
      sectorRotation: regimeComponents?.['sectorRotation'] as string ?? 'balanced',
      regimeConfidence: regimeData ? Number(regimeData.confidence) : 0.1,
    },
    macroEvents,
  };

  // 10. Write context package to synthesis_inputs
  const { error: insertError } = await supabase.from('synthesis_inputs').insert({
    user_id: userId,
    run_date: dateStr,
    context_package: contextPackage,
    asset_scope: allScoreTickers,
  });

  if (insertError) {
    console.error(`[ContextBuilder] Failed to write synthesis_inputs:`, insertError.message);
  }

  return contextPackage;
}

function mapBroadTrend(value: string | undefined): 'uptrend' | 'sideways' | 'downtrend' {
  if (value === 'strengthening') return 'uptrend';
  if (value === 'weakening') return 'downtrend';
  return 'sideways';
}
