import type { SynthesisContextPackage, AssetScoreContext } from '../../shared/types/synthesis.js';
import { getWeightsForTicker, ASSET_TYPE_MAP } from '../../shared/lib/constants.js';

function isSentimentMissing(c: AssetScoreContext): boolean {
  return ASSET_TYPE_MAP[c.ticker] === 'crypto' && c.sentimentConfidence === 0 && c.dataFreshness === 'missing';
}

export function buildSystemPrompt(): string {
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
Crypto assets have no fundamental data. Their fundamental weight is redistributed to regime.
When a crypto asset has data_freshness = 'missing' for sentiment (insufficient qualifying news), its 25% sentiment weight is redistributed: 15% to technical, 10% to regime. Ignore the sentiment score for that asset.

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

export function buildUserPrompt(context: SynthesisContextPackage): string {
  const { userContext, portfolioState, assetScores, marketRegime, macroEvents } = context;

  const lines: string[] = [];

  // Portfolio Goal
  lines.push('PORTFOLIO GOAL');
  lines.push(`Target return: ${(userContext.goalReturnPct * 100).toFixed(1)}% | Time remaining: ${userContext.timeHorizonMonths} months`);
  lines.push(`Risk profile: ${userContext.riskProfile} | Max drawdown limit: ${(userContext.maxDrawdownLimitPct * 100).toFixed(1)}%`);
  lines.push(`Current probability: ${portfolioState.goalProbabilityPct.toFixed(0)}% (${portfolioState.goalProbabilityTrend})`);
  lines.push(`Allowed asset types: ${userContext.assetTypePreference.join(', ')} | Max positions: ${userContext.maxPositions}`);
  lines.push('');

  // Portfolio State
  lines.push('PORTFOLIO STATE');
  lines.push(`Total value: $${portfolioState.totalValueUsd.toLocaleString()} | Cash: ${portfolioState.cashAllocationPct.toFixed(1)}%`);
  lines.push(`Concentration risk: ${portfolioState.concentrationRisk.toFixed(2)} (0=diversified, 1=concentrated)`);
  lines.push('');

  // Current Positions
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

  // Market Regime
  lines.push('MARKET REGIME');
  lines.push(`${marketRegime.regimeLabel} — Volatility: ${marketRegime.volatilityLevel} — Trend: ${marketRegime.broadTrend}`);
  lines.push(`Sector rotation: ${marketRegime.sectorRotation} — Regime confidence: ${marketRegime.regimeConfidence.toFixed(2)}`);
  lines.push('');

  // Macro Events
  if (macroEvents.length > 0) {
    lines.push('MACRO EVENTS (last 24h)');
    for (const event of macroEvents) {
      const sentLabel = event.sentiment > 0.2 ? 'positive' : event.sentiment < -0.2 ? 'negative' : 'neutral';
      lines.push(`- ${event.eventDescription} [${sentLabel}] → Type: ${event.eventType}`);
    }
    lines.push('');
  }

  // New Position Candidates
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
