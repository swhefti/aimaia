import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-4-6';

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * GET /api/portfolio/risk-report?portfolioId=xxx
 * Returns the latest saved risk report for the portfolio.
 */
export async function GET(req: NextRequest) {
  const portfolioId = req.nextUrl.searchParams.get('portfolioId');
  if (!portfolioId) return NextResponse.json({ error: 'Missing portfolioId' }, { status: 400 });

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('portfolio_risk_reports')
    .select('id, report, model_used, generated_at')
    .eq('portfolio_id', portfolioId)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) return NextResponse.json({ report: null });
  return NextResponse.json({ report: data });
}

/**
 * POST /api/portfolio/risk-report
 * Generates a new risk report for the portfolio.
 * Body: { portfolioId: string, positions: { ticker, quantity, avgPurchasePrice, marketValue, allocationPct }[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      portfolioId: string;
      positions: { ticker: string; quantity: number; avgPurchasePrice: number; marketValue: number; allocationPct: number }[];
    };

    const { portfolioId, positions } = body;
    if (!portfolioId || !positions?.length) {
      return NextResponse.json({ error: 'Missing portfolioId or positions' }, { status: 400 });
    }

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

    const positionsText = positions
      .map((p) => `${p.ticker}: ${p.quantity.toFixed(4)} shares @ $${p.avgPurchasePrice.toFixed(2)} avg, market value $${p.marketValue.toFixed(2)} (${p.allocationPct.toFixed(1)}% of portfolio)`)
      .join('\n');

    const systemPrompt = `You are a senior risk analyst at Bridgewater Associates trained by Ray Dalio's principles of radical transparency in investing.
I need a complete risk assessment of my current portfolio.
Evaluate:
* Correlation analysis between my holdings
* Sector concentration risk with percentage breakdown
* Geographic exposure and currency risk factors
* Interest rate sensitivity for each position
* Recession stress test showing estimated drawdown
* Liquidity risk rating for each holding
* Single stock risk and position sizing recommendations
* Tail risk scenarios with probability estimates
* Hedging strategies to reduce my top 3 risks
* Rebalancing suggestions with specific allocation percentages
Format as a professional risk management report, nicely structured.
Positions are:
${positionsText}
Length: between 200 and 250 words.`;

    const anthropic = new Anthropic({ apiKey });
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: systemPrompt }],
    });

    const report = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // Save to DB
    const supabase = getServiceSupabase();
    const { data: inserted, error } = await supabase
      .from('portfolio_risk_reports')
      .insert({ portfolio_id: portfolioId, report, model_used: MODEL })
      .select('id, report, model_used, generated_at')
      .single();

    if (error) {
      console.error('[RiskReport] DB error:', error.message);
      // Return the report even if DB save fails
      return NextResponse.json({ report: { report, model_used: MODEL, generated_at: new Date().toISOString() } });
    }

    return NextResponse.json({ report: inserted });
  } catch (err) {
    console.error('[RiskReport] Error:', err);
    return NextResponse.json({ error: 'Failed to generate risk report' }, { status: 500 });
  }
}
