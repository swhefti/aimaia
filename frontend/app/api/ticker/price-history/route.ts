import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/**
 * GET /api/ticker/price-history?ticker=AAPL&days=60
 * Returns price history for a ticker ordered by date ascending.
 * For crypto, strips -USD suffix if present (BTC-USD → BTC).
 * No auth required — public market data.
 */
export async function GET(req: NextRequest) {
  let ticker = req.nextUrl.searchParams.get('ticker');
  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker' }, { status: 400 });
  }

  // Strip -USD suffix for crypto
  ticker = ticker.replace(/-USD$/i, '');

  const daysParam = req.nextUrl.searchParams.get('days');
  const days = Math.min(Math.max(Number(daysParam) || 60, 1), 365);

  const supabase = getServiceSupabase();

  const { data, error } = await supabase
    .from('price_history')
    .select('date, open, high, low, close, volume')
    .eq('ticker', ticker)
    .order('date', { ascending: true })
    .limit(days);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []).map((r) => ({
    date: r.date as string,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }));

  const dateRange = rows.length > 0
    ? { from: rows[0]!.date, to: rows[rows.length - 1]!.date }
    : { from: null, to: null };

  return NextResponse.json({ ticker, rows, dateRange });
}
