import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * POST /api/portfolio/positions
 * Body: { portfolioId, userId, positions: [{ ticker, quantity, avgPurchasePrice }] }
 * Uses service role to bypass RLS. Verifies portfolio ownership via userId.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { portfolioId, userId, positions } = body as {
      portfolioId: string;
      userId: string;
      positions: { ticker: string; quantity: number; avgPurchasePrice: number }[];
    };

    if (!portfolioId || !userId || !positions?.length) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // Verify portfolio belongs to this user
    const { data: portfolio, error: portfolioError } = await supabase
      .from('portfolios')
      .select('id, user_id')
      .eq('id', portfolioId)
      .eq('user_id', userId)
      .single();

    if (portfolioError || !portfolio) {
      return NextResponse.json({ error: 'Portfolio not found or access denied' }, { status: 403 });
    }

    // Insert all positions
    const rows = positions.map((p) => ({
      portfolio_id: portfolioId,
      ticker: p.ticker,
      quantity: p.quantity,
      avg_purchase_price: p.avgPurchasePrice,
    }));

    const { data, error } = await supabase
      .from('portfolio_positions')
      .insert(rows)
      .select('id, ticker');

    if (error) {
      console.error('Position insert error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ saved: data?.length ?? 0, positions: data });
  } catch (err) {
    console.error('POST /api/portfolio/positions error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
