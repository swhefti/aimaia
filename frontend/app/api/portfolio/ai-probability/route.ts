import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

/**
 * POST /api/portfolio/ai-probability
 * Returns two AI-generated goal probability estimates (Opus + Sonnet).
 * The AI analyzes the portfolio in the context of the user's goal and timeframe,
 * using only raw portfolio data — no platform scores are included.
 */

const OPUS_MODEL = 'claude-opus-4-6';
const SONNET_MODEL = 'claude-sonnet-4-6';

function buildPrompt(data: {
  goalReturnPct: number;
  timeHorizonMonths: number;
  riskProfile: string;
  investmentCapital: number;
  totalValue: number;
  cashValue: number;
  cumulativeReturnPct: number;
  positions: Array<{
    ticker: string;
    quantity: number;
    avgPurchasePrice: number;
    currentPrice: number;
    currentValue: number;
    allocationPct: number;
    unrealizedPnlPct: number;
  }>;
}): { system: string; user: string } {
  const system = `You are a portfolio probability analyst. Given a user's investment portfolio and their financial goal, estimate the probability (0-100%) that they will achieve their target return within the remaining time horizon.

Consider:
- Current portfolio performance vs goal (progress so far)
- Time remaining and what annualized return is still needed
- Portfolio composition and diversification
- Individual position performance (winners vs losers)
- Cash allocation (uninvested capital)
- Risk profile alignment
- Market realism (is the needed return achievable for the asset mix?)

Do NOT use any external scoring, sentiment analysis, or technical indicators. Base your estimate purely on the portfolio's fundamentals, the goal parameters, and general market knowledge.

Return ONLY a JSON object: {"probability": number, "reasoning": string}
The probability must be between 0 and 100. The reasoning should be 1-2 sentences max.`;

  const posLines = data.positions.map((p) => {
    const pnl = p.unrealizedPnlPct >= 0 ? `+${(p.unrealizedPnlPct * 100).toFixed(1)}%` : `${(p.unrealizedPnlPct * 100).toFixed(1)}%`;
    return `  ${p.ticker}: ${p.allocationPct.toFixed(1)}% allocation, avg cost $${p.avgPurchasePrice.toFixed(2)}, current $${p.currentPrice.toFixed(2)}, P&L ${pnl}`;
  }).join('\n');

  const user = `GOAL: ${(data.goalReturnPct * 100).toFixed(1)}% return in ${data.timeHorizonMonths} months
RISK PROFILE: ${data.riskProfile}

PORTFOLIO:
  Initial capital: $${data.investmentCapital.toLocaleString()}
  Current value: $${data.totalValue.toLocaleString()}
  Cash: $${data.cashValue.toLocaleString()} (${data.totalValue > 0 ? ((data.cashValue / data.totalValue) * 100).toFixed(1) : '100'}%)
  Cumulative return: ${(data.cumulativeReturnPct * 100).toFixed(2)}%
  Positions: ${data.positions.length}

${data.positions.length > 0 ? `HOLDINGS:\n${posLines}` : 'No positions held — portfolio is 100% cash.'}`;

  return { system, user };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const data = {
    goalReturnPct: Number(body.goalReturnPct),
    timeHorizonMonths: Number(body.timeHorizonMonths),
    riskProfile: String(body.riskProfile ?? 'balanced'),
    investmentCapital: Number(body.investmentCapital),
    totalValue: Number(body.totalValue),
    cashValue: Number(body.cashValue),
    cumulativeReturnPct: Number(body.cumulativeReturnPct),
    positions: (body.positions as Array<Record<string, unknown>> ?? []).map((p) => ({
      ticker: String(p.ticker),
      quantity: Number(p.quantity),
      avgPurchasePrice: Number(p.avgPurchasePrice),
      currentPrice: Number(p.currentPrice),
      currentValue: Number(p.currentValue),
      allocationPct: Number(p.allocationPct),
      unrealizedPnlPct: Number(p.unrealizedPnlPct),
    })),
  };

  const { system, user } = buildPrompt(data);
  const anthropic = new Anthropic({ apiKey });

  // Call both models in parallel
  const [opusResult, sonnetResult] = await Promise.allSettled([
    callModel(anthropic, OPUS_MODEL, system, user),
    callModel(anthropic, SONNET_MODEL, system, user),
  ]);

  return NextResponse.json({
    opus: opusResult.status === 'fulfilled' ? opusResult.value : { probability: null, reasoning: 'Model call failed', error: true },
    sonnet: sonnetResult.status === 'fulfilled' ? sonnetResult.value : { probability: null, reasoning: 'Model call failed', error: true },
  });
}

async function callModel(
  anthropic: Anthropic,
  model: string,
  system: string,
  user: string
): Promise<{ probability: number; reasoning: string }> {
  const response = await anthropic.messages.create({
    model,
    max_tokens: 300,
    system,
    messages: [{ role: 'user', content: user }],
  });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned) as { probability: number; reasoning: string };

  return {
    probability: Math.max(0, Math.min(100, parsed.probability)),
    reasoning: parsed.reasoning,
  };
}

export const maxDuration = 60;
