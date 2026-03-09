import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { CRYPTO } from '@shared/lib/constants';

/**
 * GET /api/cron/crypto-prices
 * Called by GitHub Actions. Two modes:
 *   - No ?ticker param → returns list of crypto tickers to process
 *   - ?ticker=BTC      → fetches and saves price for that single ticker
 */

const CRYPTO_TWELVE_DATA_MAP: Record<string, string> = {
  BTC: 'BTC/USD', ETH: 'ETH/USD', BNB: 'BNB/USD', SOL: 'SOL/USD',
  XRP: 'XRP/USD', ADA: 'ADA/USD', AVAX: 'AVAX/USD', DOT: 'DOT/USD',
  LINK: 'LINK/USD', MATIC: 'MATIC/USD', LTC: 'LTC/USD', BCH: 'BCH/USD',
  ATOM: 'ATOM/USD', UNI: 'UNI/USD', AAVE: 'AAVE/USD', FIL: 'FIL/USD',
  ICP: 'ICP/USD', ALGO: 'ALGO/USD', XLM: 'XLM/USD', VET: 'VET/USD',
};

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function fetchCryptoPrice(
  supabase: ReturnType<typeof getServiceSupabase>,
  ticker: string,
  apiKey: string,
): Promise<string> {
  const symbol = CRYPTO_TWELVE_DATA_MAP[ticker] ?? `${ticker}/USD`;
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=5&apikey=${apiKey}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const json = await resp.json() as {
    values?: { datetime: string; open: string; high: string; low: string; close: string; volume: string }[];
    status?: string; message?: string;
  };

  if (json.status === 'error' || !json.values?.length) {
    return `failed: ${json.message ?? 'no data'}`;
  }

  const rows = json.values
    .filter((d) => parseFloat(d.close) > 0)
    .map((d) => ({
      ticker,
      date: d.datetime,
      open: parseFloat(d.open),
      high: parseFloat(d.high),
      low: parseFloat(d.low),
      close: parseFloat(d.close),
      volume: parseInt(d.volume) || 0,
      ingested_at: new Date().toISOString(),
    }));

  if (rows.length === 0) return 'no valid prices';

  const { error: priceErr } = await supabase.from('price_history').upsert(rows, { onConflict: 'ticker,date' });
  if (priceErr) return `price_history error: ${priceErr.message}`;

  const latest = rows[0]!;
  const prev = rows.length > 1 ? rows[1]! : latest;
  const dailyChange = latest.close - prev.close;
  const pctChange = prev.close !== 0 ? dailyChange / prev.close : 0;
  await supabase.from('market_quotes').upsert(
    { ticker, date: latest.date, last_price: latest.close, daily_change: dailyChange, pct_change: pctChange },
    { onConflict: 'ticker,date' },
  );

  return `ok (${rows.length} days)`;
}

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tickerParam = req.nextUrl.searchParams.get('ticker');

  // Mode 1: Return ticker list for orchestration
  if (!tickerParam) {
    const tickers = [...CRYPTO];
    return NextResponse.json({ tickers, count: tickers.length });
  }

  // Mode 2: Fetch a single ticker
  const apiKey = process.env['TWELVE_DATA_API_KEY'];
  if (!apiKey) {
    return NextResponse.json({ error: 'TWELVE_DATA_API_KEY not set' }, { status: 500 });
  }

  const supabase = getServiceSupabase();
  const result = await fetchCryptoPrice(supabase, tickerParam, apiKey);
  const ok = result.startsWith('ok');

  console.log(`[Cron/CryptoPrices] ${tickerParam}: ${result}`);

  return NextResponse.json({ ticker: tickerParam, result, ok });
}

export const maxDuration = 60;
