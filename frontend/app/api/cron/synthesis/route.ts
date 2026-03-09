import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import {
  ASSET_UNIVERSE,
  ASSET_TYPE_MAP,
  SYNTHESIS_MODEL,
  MAX_POSITION_PCT,
  MAX_CRYPTO_ALLOCATION_PCT,
  CASH_FLOOR_PCT,
  MAX_DAILY_CHANGES,
  DEFAULT_AGENT_WEIGHTS,
  getWeightsForTicker,
} from '@shared/lib/constants';
import type {
  SynthesisContextPackage,
  SynthesisOutput,
  SynthesisRecommendation,
  AssetScoreContext,
  PortfolioPositionContext,
  MacroEventContext,
} from '@shared/types/synthesis';
import type { AssetType } from '@shared/types/assets';

/**
 * GET /api/cron/synthesis
 * Runs the LLM Synthesis Agent for every active portfolio.
 * Should be triggered after the scoring pipeline completes.
 */

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

type SB = ReturnType<typeof getServiceSupabase>;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---- Zod schema for LLM output validation ----

const SynthesisOutputSchema = z.object({
  weightRationale: z.object({
    technical: z.number().min(0).max(1),
    sentiment: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
    regime: z.number().min(0).max(1),
    reasoning: z.string(),
  }),
  portfolioAssessment: z.object({
    goalStatus: z.enum(['on_track', 'monitor', 'at_risk', 'off_track']),
    primaryRisk: z.string(),
    assessment: z.string(),
  }),
  recommendations: z.array(
    z.object({
      ticker: z.string(),
      action: z.enum(['BUY', 'SELL', 'REDUCE', 'ADD', 'HOLD']),
      urgency: z.enum(['high', 'medium', 'low']),
      targetAllocationPct: z.number().min(0).max(100),
      reasoning: z.string(),
      confidence: z.number().min(0).max(1),
    })
  ),
  portfolioNarrative: z.string().max(2000),
  overallConfidence: z.number().min(0).max(1),
  lowConfidenceReasons: z.array(z.string()),
});

// ---- Context builder ----

function mapBroadTrend(value: string | undefined): 'uptrend' | 'sideways' | 'downtrend' {
  if (value === 'strengthening') return 'uptrend';
  if (value === 'weakening') return 'downtrend';
  return 'sideways';
}

async function buildContextPackage(
  supabase: SB,
  userId: string,
  portfolioId: string,
  dateStr: string
): Promise<SynthesisContextPackage> {
  // 1. Load user profile
  const { data: profileData } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!profileData) {
    throw new Error(`No user profile found for ${userId}`);
  }

  const profile = {
    goalReturnPct: Number(profileData.goal_return_pct),
    timeHorizonMonths: Number(profileData.time_horizon_months),
    riskProfile: profileData.risk_profile as 'conservative' | 'balanced' | 'aggressive',
    maxDrawdownLimitPct: Number(profileData.max_drawdown_limit_pct),
    volatilityTolerance: profileData.volatility_tolerance as 'moderate' | 'balanced' | 'tolerant',
    assetTypes: profileData.asset_types as AssetType[],
    maxPositions: Number(profileData.max_positions),
  };

  // 2. Load portfolio positions
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
  const twoWeeksAgo = new Date(dateStr);
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

  const investmentCapital = Number(profileData.investment_capital);
  const totalValue = valuation ? Number(valuation.total_value) : investmentCapital;
  const cashValue = valuation ? Number(valuation.cash_value) : totalValue;
  const goalProbPct = valuation ? Number(valuation.goal_probability_pct) : 50;
  const prevGoalProbPct = prevValuation ? Number(prevValuation.goal_probability_pct) : goalProbPct;

  let goalProbabilityTrend: 'improving' | 'stable' | 'declining';
  const probDiff = goalProbPct - prevGoalProbPct;
  if (probDiff > 3) goalProbabilityTrend = 'improving';
  else if (probDiff < -3) goalProbabilityTrend = 'declining';
  else goalProbabilityTrend = 'stable';

  // Build position contexts
  const positionContexts: PortfolioPositionContext[] = [];
  const positionTickers: string[] = [];

  if (positions && positions.length > 0) {
    for (const pos of positions) {
      const ticker = pos.ticker as string;
      positionTickers.push(ticker);
      const qty = Number(pos.quantity);
      const avgPrice = Number(pos.avg_purchase_price);

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

  // 4. Concentration risk
  const allocations = positionContexts.map((p) => p.currentAllocationPct / 100);
  const hhi = allocations.reduce((sum, a) => sum + a * a, 0);
  const concentrationRisk = clamp(hhi * 2, 0, 1);

  // 5. Load agent scores for portfolio positions + top candidates
  const allScoreTickers = [...positionTickers];

  // Top 5 non-owned assets by technical score
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

  // 6. Load all agent scores for selected tickers
  const { data: allAgentScores } = await supabase
    .from('agent_scores')
    .select('ticker, agent_type, score, confidence, data_freshness')
    .eq('date', dateStr)
    .in('ticker', allScoreTickers.length > 0 ? allScoreTickers : ['NONE']);

  // Load regime scores
  const { data: regimeRows } = await supabase
    .from('agent_scores')
    .select('ticker, score, confidence, component_scores')
    .in('ticker', ['MARKET', 'MARKET_CRYPTO'])
    .eq('agent_type', 'market_regime')
    .eq('date', dateStr);

  const stockRegimeData = regimeRows?.find((r) => r.ticker === 'MARKET') ?? null;
  const cryptoRegimeData = regimeRows?.find((r) => r.ticker === 'MARKET_CRYPTO') ?? null;
  const regimeData = stockRegimeData;

  // Build asset score contexts
  const scoresByTicker = new Map<string, Partial<AssetScoreContext>>();
  if (allAgentScores) {
    for (const s of allAgentScores) {
      const ticker = s.ticker as string;
      if (!scoresByTicker.has(ticker)) {
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

  // 7. Load macro events (last 24h)
  const macroStart = new Date(dateStr);
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
    relevantAssetTypes: ((e.relevant_asset_types as string[]) ?? []) as AssetType[],
  }));

  // 8. Build regime context
  const regimeComponents = regimeData?.component_scores as Record<string, string | number> | null;

  return {
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
      sectorRotation: (regimeComponents?.['sectorRotation'] as string) ?? 'balanced',
      regimeConfidence: regimeData ? Number(regimeData.confidence) : 0.1,
    },
    macroEvents,
  };
}

// ---- Prompt builder ----

function isSentimentMissing(c: AssetScoreContext): boolean {
  return ASSET_TYPE_MAP[c.ticker] === 'crypto' && c.sentimentConfidence === 0 && c.dataFreshness === 'missing';
}

function buildSystemPrompt(): string {
  return `You are the Portfolio Synthesis Agent for an investment advisory platform.
Your role is to act as a senior analyst who:
- Reads structured evidence from four specialist agents (technical, sentiment, fundamental, regime)
- Reasons about the user's portfolio as a whole, not just individual assets
- Considers context that rules cannot capture: macro events, concentration risk, goal trajectory, narrative momentum
- Produces actionable recommendations with clear reasoning
- Is honest about uncertainty and data quality

You are NOT a financial advisor. You are a reasoning engine that helps users make more informed decisions. All final decisions remain with the user.

Before producing your output, reason through the following in order:

STEP 1 — Assess goal trajectory
Is the portfolio on track? What is the trend (improving / stable / deteriorating)?
What is the biggest threat to reaching the goal?

STEP 2 — Evaluate portfolio health
Identify concentration risks. Are multiple positions correlated?
Is there sector or narrative overlap that creates hidden risk?

STEP 3 — Assess market regime impact
How does the current regime affect signal reliability?
Should technical signals be trusted more or less than usual?
Are any macro events directly relevant to portfolio positions?

STEP 4 — Evaluate each position
For each position, combine the agent scores with portfolio context.
A strong technical score in a bearish regime means something different than the same score in a bullish regime.

IMPORTANT — Weight profiles differ by asset type:
- Stocks & ETFs: Technical 50%, Sentiment 25%, Fundamental 20%, Regime 5%
- Crypto: Technical 50%, Sentiment 25%, Fundamental 0%, Regime 25%
- Crypto with missing sentiment data: Technical 65%, Sentiment 0%, Fundamental 0%, Regime 35%

STEP 5 — Identify new position candidates
From the top-scored assets not in the portfolio, assess whether any would improve diversification and goal probability.

STEP 6 — Generate structured output
Produce your JSON output. Then write the narrative.

OUTPUT FORMAT:
Return ONLY valid JSON. No preamble, no markdown fencing, no explanation outside the JSON.

The JSON must match this exact schema:
{
  "weightRationale": {
    "technical": number (0.0-1.0),
    "sentiment": number (0.0-1.0),
    "fundamental": number (0.0-1.0),
    "regime": number (0.0-1.0),
    "reasoning": string
  },
  "portfolioAssessment": {
    "goalStatus": "on_track" | "monitor" | "at_risk" | "off_track",
    "primaryRisk": string,
    "assessment": string
  },
  "recommendations": [
    {
      "ticker": string,
      "action": "BUY" | "SELL" | "REDUCE" | "ADD" | "HOLD",
      "urgency": "high" | "medium" | "low",
      "targetAllocationPct": number (0-100),
      "reasoning": string,
      "confidence": number (0.0-1.0)
    }
  ],
  "portfolioNarrative": string (max 1000 chars, 3 paragraphs max),
  "overallConfidence": number (0.0-1.0),
  "lowConfidenceReasons": string[]
}

The weights (technical + sentiment + fundamental + regime) must sum to approximately 1.0.
Include confidence scores for each recommendation and be honest about uncertainty.

CRITICAL: Only recommend tickers that appear in the CURRENT POSITIONS or NEW POSITION CANDIDATES sections above. Do NOT invent or suggest tickers not provided in the data.`;
}

function buildUserPrompt(context: SynthesisContextPackage): string {
  const { userContext, portfolioState, assetScores, marketRegime, macroEvents } = context;
  const lines: string[] = [];

  lines.push('PORTFOLIO GOAL');
  lines.push(`Target return: ${(userContext.goalReturnPct * 100).toFixed(1)}% | Time remaining: ${userContext.timeHorizonMonths} months`);
  lines.push(`Risk profile: ${userContext.riskProfile} | Max drawdown limit: ${(userContext.maxDrawdownLimitPct * 100).toFixed(1)}%`);
  lines.push(`Current probability: ${portfolioState.goalProbabilityPct.toFixed(0)}% (${portfolioState.goalProbabilityTrend})`);
  lines.push(`Allowed asset types: ${userContext.assetTypePreference.join(', ')} | Max positions: ${userContext.maxPositions}`);
  lines.push('');

  lines.push('PORTFOLIO STATE');
  lines.push(`Total value: $${portfolioState.totalValueUsd.toLocaleString()} | Cash: ${portfolioState.cashAllocationPct.toFixed(1)}%`);
  lines.push(`Concentration risk: ${portfolioState.concentrationRisk.toFixed(2)} (0=diversified, 1=concentrated)`);
  lines.push('');

  if (portfolioState.positions.length > 0) {
    lines.push('CURRENT POSITIONS');
    for (const pos of portfolioState.positions) {
      const pnlStr = pos.unrealizedPnlPct >= 0
        ? `+${(pos.unrealizedPnlPct * 100).toFixed(1)}%`
        : `${(pos.unrealizedPnlPct * 100).toFixed(1)}%`;
      const nearDrawdown = Math.abs(pos.unrealizedPnlPct) >= (userContext.maxDrawdownLimitPct - 0.05);
      const warning = nearDrawdown ? ' [NEAR DRAWDOWN LIMIT]' : '';
      lines.push(`${pos.ticker} — ${pos.currentAllocationPct.toFixed(1)}% — P&L: ${pnlStr}${warning}`);

      const scores = assetScores.find((s) => s.ticker === pos.ticker);
      if (scores) {
        lines.push(`  Technical: ${scores.technicalScore.toFixed(2)} (conf=${scores.technicalConfidence.toFixed(2)}) | Sentiment: ${scores.sentimentScore.toFixed(2)} (conf=${scores.sentimentConfidence.toFixed(2)}) | Fundamental: ${scores.fundamentalScore.toFixed(2)} (conf=${scores.fundamentalConfidence.toFixed(2)})`);
      }
    }
    lines.push('');
  }

  lines.push('MARKET REGIME');
  lines.push(`${marketRegime.regimeLabel} — Volatility: ${marketRegime.volatilityLevel} — Trend: ${marketRegime.broadTrend}`);
  lines.push(`Sector rotation: ${marketRegime.sectorRotation} — Regime confidence: ${marketRegime.regimeConfidence.toFixed(2)}`);
  lines.push('');

  if (macroEvents.length > 0) {
    lines.push('MACRO EVENTS (last 24h)');
    for (const event of macroEvents) {
      const sentLabel = event.sentiment > 0.2 ? 'positive' : event.sentiment < -0.2 ? 'negative' : 'neutral';
      lines.push(`- ${event.eventDescription} [${sentLabel}] → Type: ${event.eventType}`);
    }
    lines.push('');
  }

  const positionTickers = new Set(portfolioState.positions.map((p) => p.ticker));
  const candidates = assetScores.filter((s) => !positionTickers.has(s.ticker));
  if (candidates.length > 0) {
    lines.push('NEW POSITION CANDIDATES');
    for (const c of candidates) {
      const sentMissing = isSentimentMissing(c);
      const w = getWeightsForTicker(c.ticker, sentMissing);
      const combined =
        c.technicalScore * w.technical + c.sentimentScore * w.sentiment + c.fundamentalScore * w.fundamental + c.regimeScore * w.regime;
      const sentLabel = sentMissing ? 'N/A (missing)' : c.sentimentScore.toFixed(2);
      lines.push(`${c.ticker} — Combined score: ${combined.toFixed(2)}`);
      lines.push(`  Technical: ${c.technicalScore.toFixed(2)} | Sentiment: ${sentLabel} | Fundamental: ${c.fundamentalScore.toFixed(2)} | Data: ${c.dataFreshness}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---- Rules engine ----

interface PortfolioState {
  positions: Array<{ ticker: string; allocationPct: number; unrealizedPnlPct: number }>;
  cashPct: number;
  totalValue: number;
}

interface RulesOverride {
  rule: string;
  ticker: string;
  originalAction: string;
  newAction: string;
  reason: string;
}

function applyRulesEngine(
  output: SynthesisOutput,
  userAssetTypes: AssetType[],
  maxDrawdownLimitPct: number,
  portfolioState: PortfolioState
): { validated: SynthesisOutput; overrides: RulesOverride[] } {
  const overrides: RulesOverride[] = [];
  let recs = [...output.recommendations];

  // Rule: Drawdown hard stop
  for (const pos of portfolioState.positions) {
    const drawdownPct = Math.abs(Math.min(0, pos.unrealizedPnlPct));
    if (drawdownPct >= maxDrawdownLimitPct) {
      const existing = recs.find((r) => r.ticker === pos.ticker);
      if (existing && existing.action !== 'SELL') {
        overrides.push({ rule: 'drawdown_hard_stop', ticker: pos.ticker, originalAction: existing.action, newAction: 'SELL', reason: `Drawdown ${(drawdownPct * 100).toFixed(1)}% past limit` });
        existing.action = 'SELL';
        existing.urgency = 'high';
        existing.targetAllocationPct = 0;
        existing.reasoning = `RULES ENGINE: Drawdown limit breached. ${existing.reasoning}`;
      } else if (!existing) {
        overrides.push({ rule: 'drawdown_hard_stop', ticker: pos.ticker, originalAction: 'NONE', newAction: 'SELL', reason: `Drawdown limit breached` });
        recs.push({ ticker: pos.ticker, action: 'SELL', urgency: 'high', targetAllocationPct: 0, reasoning: 'RULES ENGINE: Drawdown limit breached.', confidence: 0.95 });
      }
    }
  }

  // Rule: Max position cap
  for (const rec of recs) {
    if (rec.targetAllocationPct > MAX_POSITION_PCT * 100) {
      overrides.push({ rule: 'max_position_cap', ticker: rec.ticker, originalAction: `${rec.action} to ${rec.targetAllocationPct}%`, newAction: `${rec.action} to ${MAX_POSITION_PCT * 100}%`, reason: `Exceeds ${MAX_POSITION_PCT * 100}% cap` });
      rec.targetAllocationPct = MAX_POSITION_PCT * 100;
    }
  }

  // Rule: Asset type constraint
  recs = recs.filter((rec) => {
    const assetType = ASSET_TYPE_MAP[rec.ticker];
    if (assetType && !userAssetTypes.includes(assetType)) {
      overrides.push({ rule: 'asset_type_constraint', ticker: rec.ticker, originalAction: rec.action, newAction: 'REMOVED', reason: `Asset type '${assetType}' not in user preferences` });
      return false;
    }
    return true;
  });

  // Rule: Max daily changes
  const nonHold = recs.filter((r) => r.action !== 'HOLD');
  if (nonHold.length > MAX_DAILY_CHANGES) {
    const urgencyOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    nonHold.sort((a, b) => ((urgencyOrder[b.urgency] ?? 0) + b.confidence) - ((urgencyOrder[a.urgency] ?? 0) + a.confidence));
    const kept = new Set(nonHold.slice(0, MAX_DAILY_CHANGES).map((r) => r.ticker));
    for (const r of nonHold.filter((r) => !kept.has(r.ticker))) {
      overrides.push({ rule: 'max_daily_changes', ticker: r.ticker, originalAction: r.action, newAction: 'HOLD', reason: `Exceeded max ${MAX_DAILY_CHANGES} changes` });
    }
    recs = recs.filter((r) => r.action === 'HOLD' || kept.has(r.ticker));
  }

  // Rule: Cash floor
  const buyRecs = recs.filter((r) => r.action === 'BUY' || r.action === 'ADD');
  if (buyRecs.length > 0) {
    const totalBuyPct = buyRecs.reduce((sum, r) => {
      const currentPct = portfolioState.positions.find((p) => p.ticker === r.ticker)?.allocationPct ?? 0;
      return sum + Math.max(0, r.targetAllocationPct - currentPct);
    }, 0);
    const projectedCashPct = portfolioState.cashPct - totalBuyPct;
    if (projectedCashPct < CASH_FLOOR_PCT * 100) {
      const sortedBuys = [...buyRecs].sort((a, b) => a.confidence - b.confidence);
      let removedPct = 0;
      const cashDeficit = (CASH_FLOOR_PCT * 100) - projectedCashPct;
      for (const buy of sortedBuys) {
        if (removedPct >= cashDeficit) break;
        const currentPct = portfolioState.positions.find((p) => p.ticker === buy.ticker)?.allocationPct ?? 0;
        const buyAmount = Math.max(0, buy.targetAllocationPct - currentPct);
        overrides.push({ rule: 'cash_floor', ticker: buy.ticker, originalAction: buy.action, newAction: 'REMOVED', reason: `Cash would drop below ${CASH_FLOOR_PCT * 100}% floor` });
        recs = recs.filter((r) => r.ticker !== buy.ticker || r.action === 'HOLD');
        removedPct += buyAmount;
      }
    }
  }

  // Rule: Crypto allocation cap
  const cryptoRecs = recs.filter((r) => ASSET_TYPE_MAP[r.ticker] === 'crypto' && r.action !== 'SELL');
  if (cryptoRecs.length > 0) {
    const projectedCryptoAllocation = cryptoRecs.reduce((sum, r) => sum + r.targetAllocationPct, 0);
    if (projectedCryptoAllocation > MAX_CRYPTO_ALLOCATION_PCT * 100) {
      const scale = (MAX_CRYPTO_ALLOCATION_PCT * 100) / projectedCryptoAllocation;
      for (const rec of cryptoRecs) {
        const original = rec.targetAllocationPct;
        rec.targetAllocationPct = Math.round(rec.targetAllocationPct * scale * 100) / 100;
        if (original !== rec.targetAllocationPct) {
          overrides.push({ rule: 'crypto_cap', ticker: rec.ticker, originalAction: `${rec.action} to ${original}%`, newAction: `${rec.action} to ${rec.targetAllocationPct}%`, reason: `Total crypto exceeds ${MAX_CRYPTO_ALLOCATION_PCT * 100}% cap` });
        }
      }
    }
  }

  return { validated: { ...output, recommendations: recs }, overrides };
}

// ---- Fallback recommendations ----

function generateFallbackRecommendations(
  agentScores: Array<{ ticker: string; agent_type: string; score: number; confidence: number; data_freshness: string }>,
  userAssetTypes: AssetType[],
  portfolioState: PortfolioState
): SynthesisOutput {
  const recommendations: SynthesisRecommendation[] = [];

  // For existing positions: evaluate based on scores
  for (const pos of portfolioState.positions) {
    const scores = agentScores.filter((s) => s.ticker === pos.ticker);
    const techScore = scores.find((s) => s.agent_type === 'technical')?.score ?? 0;
    const sentEntry = scores.find((s) => s.agent_type === 'sentiment');
    const sentScore = sentEntry?.score ?? 0;
    const fundScore = scores.find((s) => s.agent_type === 'fundamental')?.score ?? 0;
    const regimeScore = scores.find((s) => s.agent_type === 'market_regime')?.score ?? 0;

    const sentimentMissing = ASSET_TYPE_MAP[pos.ticker] === 'crypto'
      && (sentEntry?.data_freshness === 'missing' || (sentEntry?.confidence ?? 0) === 0);
    const w = getWeightsForTicker(pos.ticker, sentimentMissing);
    const combined = techScore * w.technical + sentScore * w.sentiment + fundScore * w.fundamental + regimeScore * w.regime;

    let action: SynthesisRecommendation['action'] = 'HOLD';
    if (combined >= 0.6) action = 'ADD';
    else if (combined <= -0.6) action = 'SELL';
    else if (combined <= -0.2) action = 'REDUCE';

    recommendations.push({
      ticker: pos.ticker, action,
      urgency: Math.abs(combined) > 0.5 ? 'high' : 'medium',
      targetAllocationPct: action === 'SELL' ? 0 : pos.allocationPct,
      reasoning: `Math-based fallback: combined score ${combined.toFixed(2)}`,
      confidence: 0.3,
    });
  }

  // For empty portfolios: suggest top assets by score
  if (portfolioState.positions.length === 0) {
    const tickerBestScores = new Map<string, number>();
    for (const s of agentScores) {
      if (s.agent_type !== 'technical') continue;
      const type = ASSET_TYPE_MAP[s.ticker];
      if (!type || !userAssetTypes.includes(type)) continue;
      tickerBestScores.set(s.ticker, s.score);
    }

    const sorted = [...tickerBestScores.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const allocPerPosition = sorted.length > 0 ? Math.floor(90 / sorted.length) : 0;

    for (const [ticker, score] of sorted) {
      if (score < 0) continue;
      recommendations.push({
        ticker, action: 'BUY',
        urgency: score > 0.4 ? 'high' : 'medium',
        targetAllocationPct: allocPerPosition,
        reasoning: `Top-scored asset (technical score ${score.toFixed(2)}). Suggested for new portfolio.`,
        confidence: 0.3,
      });
    }
  }

  return {
    weightRationale: {
      technical: DEFAULT_AGENT_WEIGHTS.technical,
      sentiment: DEFAULT_AGENT_WEIGHTS.sentiment,
      fundamental: DEFAULT_AGENT_WEIGHTS.fundamental,
      regime: DEFAULT_AGENT_WEIGHTS.regime,
      reasoning: 'Fallback to default weights — LLM synthesis was unavailable.',
    },
    portfolioAssessment: {
      goalStatus: 'monitor',
      primaryRisk: 'unknown',
      assessment: 'LLM synthesis unavailable. Using quantitative signals only.',
    },
    recommendations,
    portfolioNarrative: 'Low conviction today — recommendations based on quantitative signals only. The AI synthesis engine was unavailable, so today\'s guidance relies on mathematical indicator scores without contextual reasoning.',
    overallConfidence: 0.3,
    lowConfidenceReasons: ['LLM synthesis agent unavailable — fallback to rules-based output'],
  };
}

// ---- Narrative formatter ----

function formatNarrative(output: SynthesisOutput): string {
  let narrative = output.portfolioNarrative;
  const paragraphs = narrative.split(/\n\n+/).filter((p) => p.trim().length > 0);
  if (paragraphs.length > 3) narrative = paragraphs.slice(0, 3).join('\n\n');
  if (narrative.length > 1000) narrative = narrative.slice(0, 997) + '...';
  return narrative.trim();
}

// ---- Run synthesis for a single portfolio ----

async function runSynthesisForPortfolio(
  supabase: SB,
  anthropic: Anthropic,
  portfolioId: string,
  userId: string,
  dateStr: string
): Promise<string> {
  console.log(`[Synthesis] Starting for portfolio ${portfolioId}, user ${userId}`);

  // 1. Build context
  const context = await buildContextPackage(supabase, userId, portfolioId, dateStr);

  // 2. Load user profile for rules engine
  const { data: profileData } = await supabase
    .from('user_profiles')
    .select('asset_types, max_drawdown_limit_pct')
    .eq('user_id', userId)
    .single();

  const userAssetTypes = (profileData?.asset_types as AssetType[]) ?? ['stock', 'etf', 'crypto'];
  const maxDrawdownLimitPct = Number(profileData?.max_drawdown_limit_pct ?? 0.15);

  // Portfolio state for rules engine
  const portfolioState: PortfolioState = {
    positions: context.portfolioState.positions.map((p) => ({
      ticker: p.ticker,
      allocationPct: p.currentAllocationPct,
      unrealizedPnlPct: p.unrealizedPnlPct,
    })),
    cashPct: context.portfolioState.cashAllocationPct,
    totalValue: context.portfolioState.totalValueUsd,
  };

  let finalOutput: SynthesisOutput;
  let overrides: RulesOverride[] = [];
  let runId: string | undefined;
  let llmSucceeded = false;
  let llmErrMsg: string | undefined;

  // 3. Try LLM synthesis
  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(context);
    const startTime = Date.now();

    // Delete any existing runs for today (allows re-runs)
    const { data: existingRuns } = await supabase
      .from('synthesis_runs')
      .select('id')
      .eq('portfolio_id', portfolioId)
      .eq('run_date', dateStr);

    if (existingRuns && existingRuns.length > 0) {
      const existingRunIds = existingRuns.map((r) => r.id as string);
      // Delete old recommendation items and runs for today
      const { data: oldRecRuns } = await supabase
        .from('recommendation_runs')
        .select('id')
        .in('synthesis_run_id', existingRunIds);
      if (oldRecRuns && oldRecRuns.length > 0) {
        const oldRecRunIds = oldRecRuns.map((r) => r.id as string);
        await supabase.from('recommendation_items').delete().in('run_id', oldRecRunIds);
        await supabase.from('recommendation_runs').delete().in('id', oldRecRunIds);
      }
      await supabase.from('synthesis_raw_outputs').delete().in('synthesis_run_id', existingRunIds);
      await supabase.from('synthesis_runs').delete().in('id', existingRunIds);
    }

    // Create synthesis_runs record
    const { data: runRecord, error: runInsertError } = await supabase
      .from('synthesis_runs')
      .insert({
        user_id: userId,
        portfolio_id: portfolioId,
        run_date: dateStr,
        model_used: SYNTHESIS_MODEL,
        input_tokens: 0,
        output_tokens: 0,
        latency_ms: 0,
        llm_call_succeeded: false,
        fallback_used: false,
      })
      .select('id')
      .single();

    if (runInsertError || !runRecord) {
      throw new Error(`Failed to create synthesis_runs: ${runInsertError?.message ?? 'no data returned'}`);
    }

    runId = runRecord.id as string;

    const response = await anthropic.messages.create({
      model: SYNTHESIS_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const latencyMs = Date.now() - startTime;
    const rawText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const cleaned = rawText.replace(/```json|```/g, '').trim();
    let parsed: unknown;

    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Retry with format reminder
      const retryResponse = await anthropic.messages.create({
        model: SYNTHESIS_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: cleaned },
          { role: 'user', content: 'Your response was not valid JSON. Return ONLY valid JSON matching the schema.' },
        ],
      });
      const retryText = retryResponse.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      parsed = JSON.parse(retryText.replace(/```json|```/g, '').trim());
    }

    const validated = SynthesisOutputSchema.safeParse(parsed);
    if (validated.success) {
      finalOutput = validated.data as SynthesisOutput;
      llmSucceeded = true;

      // Update run record with success
      await supabase.from('synthesis_runs').update({
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        latency_ms: latencyMs,
        llm_call_succeeded: true,
        fallback_used: false,
      }).eq('id', runId);

      // Write raw output
      await supabase.from('synthesis_raw_outputs').insert({
        synthesis_run_id: runId,
        raw_llm_output: parsed,
        post_rules_output: null,
        overrides_applied: [],
        low_confidence_reasons: finalOutput.lowConfidenceReasons,
      });

      // Apply rules engine
      const rulesResult = applyRulesEngine(finalOutput, userAssetTypes, maxDrawdownLimitPct, portfolioState);
      finalOutput = rulesResult.validated;
      overrides = rulesResult.overrides;

      // Update raw output with post-rules
      await supabase.from('synthesis_raw_outputs').update({
        post_rules_output: finalOutput,
        overrides_applied: overrides,
      }).eq('synthesis_run_id', runId);
    } else {
      console.warn('[Synthesis] LLM output failed validation:', validated.error.issues);
      await supabase.from('synthesis_runs').update({
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        latency_ms: latencyMs,
        llm_call_succeeded: false,
        fallback_used: true,
      }).eq('id', runId);
      throw new Error('LLM output failed validation');
    }
  } catch (llmErr) {
    // Fallback to math-based recommendations
    llmErrMsg = llmErr instanceof Error ? llmErr.message : String(llmErr);
    console.warn(`[Synthesis] LLM failed for ${portfolioId}, using fallback:`, llmErrMsg);

    const { data: scoresData } = await supabase
      .from('agent_scores')
      .select('ticker, agent_type, score, confidence, data_freshness')
      .eq('date', dateStr);

    const scores = (scoresData ?? []).map((s) => ({
      ticker: s.ticker as string,
      agent_type: s.agent_type as string,
      score: Number(s.score),
      confidence: Number(s.confidence),
      data_freshness: (s.data_freshness as string) ?? 'missing',
    }));

    finalOutput = generateFallbackRecommendations(scores, userAssetTypes, portfolioState);

    // Create fallback run record if we don't have one
    if (!runId) {
      const { data: fallbackRun } = await supabase
        .from('synthesis_runs')
        .insert({
          user_id: userId,
          portfolio_id: portfolioId,
          run_date: dateStr,
          model_used: 'fallback',
          input_tokens: 0,
          output_tokens: 0,
          latency_ms: 0,
          llm_call_succeeded: false,
          fallback_used: true,
        })
        .select('id')
        .single();
      if (!fallbackRun) {
        return `error: failed to create fallback synthesis_runs record`;
      }
      runId = fallbackRun.id as string;
    } else {
      await supabase.from('synthesis_runs').update({ fallback_used: true }).eq('id', runId);
    }
  }

  // 4. Format narrative
  finalOutput.portfolioNarrative = formatNarrative(finalOutput);

  // 5. Write recommendation_runs
  const { data: recRun, error: recRunError } = await supabase
    .from('recommendation_runs')
    .insert({
      portfolio_id: portfolioId,
      run_date: dateStr,
      synthesis_run_id: runId!,
      overall_confidence: finalOutput.overallConfidence,
      goal_status: finalOutput.portfolioAssessment.goalStatus,
      portfolio_narrative: finalOutput.portfolioNarrative,
      weight_rationale: finalOutput.weightRationale,
      fallback_used: !llmSucceeded,
    })
    .select('id')
    .single();

  if (recRunError || !recRun) {
    console.error('[Synthesis] Failed to write recommendation_runs:', recRunError?.message);
    return `error: ${recRunError?.message}`;
  }

  const recRunId = recRun.id as string;

  // 6. Validate tickers exist in assets table
  const { data: validAssets } = await supabase.from('assets').select('ticker');
  const validTickers = new Set((validAssets ?? []).map((a) => a.ticker as string));

  const validRecs = finalOutput.recommendations.filter((rec) => {
    if (!validTickers.has(rec.ticker)) {
      console.warn(`[Synthesis] Skipping unknown ticker: ${rec.ticker}`);
      return false;
    }
    return true;
  });

  // 7. Write recommendation_items
  for (let i = 0; i < validRecs.length; i++) {
    const rec = validRecs[i]!;
    const currentPos = portfolioState.positions.find((p) => p.ticker === rec.ticker);
    const override = overrides.find((o) => o.ticker === rec.ticker);

    const { error: itemError } = await supabase.from('recommendation_items').insert({
      run_id: recRunId,
      ticker: rec.ticker,
      action: rec.action,
      urgency: rec.urgency,
      current_allocation_pct: currentPos?.allocationPct ?? 0,
      target_allocation_pct: rec.targetAllocationPct,
      llm_reasoning: rec.reasoning,
      confidence: rec.confidence,
      rules_engine_applied: !!override,
      rules_engine_note: override ? `${override.rule}: ${override.reason}` : null,
      priority: i + 1,
    });

    if (itemError) {
      console.error(`[Synthesis] Failed to insert recommendation for ${rec.ticker}:`, itemError.message);
    }
  }

  const llmNote = llmSucceeded ? 'llm=true' : `llm=false (${llmErrMsg ?? 'fallback'})`;
  console.log(`[Synthesis] Complete for ${portfolioId}. ${validRecs.length} recommendations, ${overrides.length} overrides. ${llmNote}`);
  return `ok (${validRecs.length} recs, ${overrides.length} overrides, ${llmNote})`;
}

// ---- Main handler ----

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

  const supabase = getServiceSupabase();
  const anthropic = new Anthropic({ apiKey });
  const dateStr = new Date().toISOString().split('T')[0]!;
  const startedAt = new Date().toISOString();

  console.log(`[Cron/Synthesis] Starting for ${dateStr}`);

  // Find all active portfolios
  const { data: portfolios, error: portfolioError } = await supabase
    .from('portfolios')
    .select('id, user_id')
    .eq('status', 'active');

  if (portfolioError) {
    return NextResponse.json({ error: portfolioError.message }, { status: 500 });
  }

  if (!portfolios || portfolios.length === 0) {
    return NextResponse.json({ message: 'No active portfolios', date: dateStr });
  }

  const results: Record<string, string> = {};

  // Process portfolios sequentially to avoid overwhelming the LLM API
  for (const portfolio of portfolios) {
    const userId = portfolio.user_id as string;
    const portfolioId = portfolio.id as string;

    try {
      results[portfolioId] = await runSynthesisForPortfolio(
        supabase, anthropic, portfolioId, userId, dateStr
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Cron/Synthesis] Error for ${portfolioId}:`, msg);
      results[portfolioId] = `error: ${msg}`;
    }
  }

  const completedAt = new Date().toISOString();
  const successCount = Object.values(results).filter((r) => r.startsWith('ok')).length;
  const errorCount = Object.values(results).filter((r) => r.startsWith('error')).length;

  console.log(`[Cron/Synthesis] Done: ${successCount} success, ${errorCount} errors`);

  return NextResponse.json({
    startedAt,
    completedAt,
    date: dateStr,
    portfolios: portfolios.length,
    success: successCount,
    errors: errorCount,
    results,
  });
}

export const maxDuration = 300;
