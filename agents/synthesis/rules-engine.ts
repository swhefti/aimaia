import type { SynthesisOutput, SynthesisRecommendation } from '../../shared/types/synthesis.js';
import type { UserProfile, PortfolioValuation } from '../../shared/types/portfolio.js';
import type { AgentScore } from '../../shared/types/scores.js';
import {
  MAX_POSITION_PCT,
  CASH_FLOOR_PCT,
  MAX_DAILY_CHANGES,
  MAX_CRYPTO_ALLOCATION_PCT,
  DEFAULT_AGENT_WEIGHTS,
  ASSET_TYPE_MAP,
  getWeightsForTicker,
} from '../../shared/lib/constants.js';

export interface RulesOverride {
  rule: string;
  ticker: string;
  originalAction: string;
  newAction: string;
  reason: string;
}

export interface PortfolioState {
  positions: Array<{
    ticker: string;
    allocationPct: number;
    unrealizedPnlPct: number;
  }>;
  cashPct: number;
  totalValue: number;
}

export async function applyRulesEngine(
  output: SynthesisOutput,
  userProfile: UserProfile,
  portfolioState: PortfolioState
): Promise<{ validated: SynthesisOutput; overrides: RulesOverride[] }> {
  const overrides: RulesOverride[] = [];
  let recs = [...output.recommendations];

  // Rule 2: Drawdown hard stop (apply first — highest priority)
  for (const pos of portfolioState.positions) {
    const drawdownPct = Math.abs(Math.min(0, pos.unrealizedPnlPct));
    if (drawdownPct >= userProfile.maxDrawdownLimitPct) {
      const existing = recs.find((r) => r.ticker === pos.ticker);
      if (existing) {
        if (existing.action !== 'SELL') {
          overrides.push({
            rule: 'drawdown_hard_stop',
            ticker: pos.ticker,
            originalAction: existing.action,
            newAction: 'SELL',
            reason: `Position at ${(drawdownPct * 100).toFixed(1)}% drawdown, past user limit of ${(userProfile.maxDrawdownLimitPct * 100).toFixed(1)}%`,
          });
          existing.action = 'SELL';
          existing.urgency = 'high';
          existing.targetAllocationPct = 0;
          existing.reasoning = `RULES ENGINE OVERRIDE: Drawdown limit breached. Forced sell. ${existing.reasoning}`;
        }
      } else {
        overrides.push({
          rule: 'drawdown_hard_stop',
          ticker: pos.ticker,
          originalAction: 'NONE',
          newAction: 'SELL',
          reason: `Position at ${(drawdownPct * 100).toFixed(1)}% drawdown, past user limit`,
        });
        recs.push({
          ticker: pos.ticker,
          action: 'SELL',
          urgency: 'high',
          targetAllocationPct: 0,
          reasoning: 'RULES ENGINE: Drawdown limit breached. Forced sell.',
          confidence: 0.95,
        });
      }
    }
  }

  // Rule 1: Max single position cap (30%)
  for (const rec of recs) {
    if (rec.targetAllocationPct > MAX_POSITION_PCT * 100) {
      overrides.push({
        rule: 'max_position_cap',
        ticker: rec.ticker,
        originalAction: `${rec.action} to ${rec.targetAllocationPct}%`,
        newAction: `${rec.action} to ${MAX_POSITION_PCT * 100}%`,
        reason: `Target allocation ${rec.targetAllocationPct}% exceeds ${MAX_POSITION_PCT * 100}% cap`,
      });
      rec.targetAllocationPct = MAX_POSITION_PCT * 100;
    }
  }

  // Rule 4: Asset type constraint
  recs = recs.filter((rec) => {
    const assetType = ASSET_TYPE_MAP[rec.ticker];
    if (assetType && !userProfile.assetTypes.includes(assetType)) {
      overrides.push({
        rule: 'asset_type_constraint',
        ticker: rec.ticker,
        originalAction: rec.action,
        newAction: 'REMOVED',
        reason: `Asset type '${assetType}' not in user preferences: ${userProfile.assetTypes.join(', ')}`,
      });
      return false;
    }
    return true;
  });

  // Rule 3: Max daily changes (keep top 3 non-HOLD by urgency + confidence)
  const nonHold = recs.filter((r) => r.action !== 'HOLD');
  if (nonHold.length > MAX_DAILY_CHANGES) {
    const urgencyOrder: Record<string, number> = { high: 3, medium: 2, low: 1 };
    nonHold.sort((a, b) => {
      const aScore = (urgencyOrder[a.urgency] ?? 0) + a.confidence;
      const bScore = (urgencyOrder[b.urgency] ?? 0) + b.confidence;
      return bScore - aScore;
    });

    const kept = new Set(nonHold.slice(0, MAX_DAILY_CHANGES).map((r) => r.ticker));
    const removed = nonHold.filter((r) => !kept.has(r.ticker));

    for (const r of removed) {
      overrides.push({
        rule: 'max_daily_changes',
        ticker: r.ticker,
        originalAction: r.action,
        newAction: 'HOLD',
        reason: `Exceeded max ${MAX_DAILY_CHANGES} changes per day. Lower priority recommendation removed.`,
      });
    }

    recs = recs.filter((r) => r.action === 'HOLD' || kept.has(r.ticker));
  }

  // Rule 5: Cash floor
  const buyRecs = recs.filter((r) => r.action === 'BUY' || r.action === 'ADD');
  if (buyRecs.length > 0) {
    const totalBuyPct = buyRecs.reduce((sum, r) => {
      const currentPct = portfolioState.positions.find((p) => p.ticker === r.ticker)?.allocationPct ?? 0;
      return sum + Math.max(0, r.targetAllocationPct - currentPct);
    }, 0);

    const projectedCashPct = portfolioState.cashPct - totalBuyPct;
    if (projectedCashPct < CASH_FLOOR_PCT * 100) {
      // Remove lowest priority buys until cash floor is satisfied
      const sortedBuys = [...buyRecs].sort((a, b) => a.confidence - b.confidence);
      let removedPct = 0;
      const cashDeficit = (CASH_FLOOR_PCT * 100) - projectedCashPct;

      for (const buy of sortedBuys) {
        if (removedPct >= cashDeficit) break;
        const currentPct = portfolioState.positions.find((p) => p.ticker === buy.ticker)?.allocationPct ?? 0;
        const buyAmount = Math.max(0, buy.targetAllocationPct - currentPct);
        overrides.push({
          rule: 'cash_floor',
          ticker: buy.ticker,
          originalAction: buy.action,
          newAction: 'REMOVED',
          reason: `Cash would drop below ${CASH_FLOOR_PCT * 100}% floor`,
        });
        recs = recs.filter((r) => r.ticker !== buy.ticker || r.action === 'HOLD');
        removedPct += buyAmount;
      }
    }
  }

  // Rule 6: Crypto allocation cap
  const cryptoRecs = recs.filter((r) => ASSET_TYPE_MAP[r.ticker] === 'crypto' && r.action !== 'SELL');
  if (cryptoRecs.length > 0) {
    const currentCryptoAllocation = portfolioState.positions
      .filter((p) => ASSET_TYPE_MAP[p.ticker] === 'crypto')
      .reduce((sum, p) => sum + p.allocationPct, 0);

    const projectedCryptoAllocation = cryptoRecs.reduce((sum, r) => sum + r.targetAllocationPct, 0);

    if (projectedCryptoAllocation > MAX_CRYPTO_ALLOCATION_PCT * 100) {
      const scale = (MAX_CRYPTO_ALLOCATION_PCT * 100) / projectedCryptoAllocation;
      for (const rec of cryptoRecs) {
        const original = rec.targetAllocationPct;
        rec.targetAllocationPct = Math.round(rec.targetAllocationPct * scale * 100) / 100;
        if (original !== rec.targetAllocationPct) {
          overrides.push({
            rule: 'crypto_cap',
            ticker: rec.ticker,
            originalAction: `${rec.action} to ${original}%`,
            newAction: `${rec.action} to ${rec.targetAllocationPct}%`,
            reason: `Total crypto allocation would exceed ${MAX_CRYPTO_ALLOCATION_PCT * 100}% cap`,
          });
        }
      }
    }
  }

  return {
    validated: { ...output, recommendations: recs },
    overrides,
  };
}

export function generateFallbackRecommendations(
  agentScores: AgentScore[],
  userProfile: UserProfile,
  portfolioState: PortfolioState
): SynthesisOutput {
  const recommendations: SynthesisRecommendation[] = [];

  for (const pos of portfolioState.positions) {
    const scores = agentScores.filter((s) => s.ticker === pos.ticker);
    const techScore = scores.find((s) => s.agentType === 'technical')?.score ?? 0;
    const sentimentEntry = scores.find((s) => s.agentType === 'sentiment');
    const sentScore = sentimentEntry?.score ?? 0;
    const fundScore = scores.find((s) => s.agentType === 'fundamental')?.score ?? 0;
    const regimeScore = scores.find((s) => s.agentType === 'market_regime')?.score ?? 0;

    const sentimentMissing = ASSET_TYPE_MAP[pos.ticker] === 'crypto'
      && (sentimentEntry?.dataFreshness === 'missing' || sentimentEntry?.confidence === 0);
    const w = getWeightsForTicker(pos.ticker, sentimentMissing);
    const combined =
      techScore * w.technical +
      sentScore * w.sentiment +
      fundScore * w.fundamental +
      regimeScore * w.regime;

    let action: SynthesisRecommendation['action'] = 'HOLD';
    if (combined >= 0.6) action = 'ADD';
    else if (combined >= 0.2) action = 'HOLD';
    else if (combined >= -0.2) action = 'HOLD';
    else if (combined >= -0.6) action = 'REDUCE';
    else action = 'SELL';

    recommendations.push({
      ticker: pos.ticker,
      action,
      urgency: Math.abs(combined) > 0.5 ? 'high' : 'medium',
      targetAllocationPct: action === 'SELL' ? 0 : pos.allocationPct,
      reasoning: `Math-based fallback: combined score ${combined.toFixed(2)} (T=${techScore.toFixed(2)}, S=${sentScore.toFixed(2)}, F=${fundScore.toFixed(2)}, R=${regimeScore.toFixed(2)})`,
      confidence: 0.3,
    });
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
    portfolioNarrative:
      'Low conviction today — recommendations based on quantitative signals only. The AI synthesis engine was unavailable, so today\'s guidance relies on mathematical indicator scores without contextual reasoning. Consider waiting for the next full analysis before making significant changes.',
    overallConfidence: 0.3,
    lowConfidenceReasons: ['LLM synthesis agent unavailable — fallback to rules-based output'],
  };
}
