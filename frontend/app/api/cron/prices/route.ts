import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { STOCKS, ETFS, CRYPTO } from '@shared/lib/constants';

/**
 * GET /api/cron/prices
 * Vercel Cron: runs daily at 21:00 UTC (after US market close).
 * Fetches OHLCV for all stocks, ETFs, and crypto from Twelve Data.
 */

const CRYPTO_TWELVE_DATA_MAP: Record<string, string> = {
  BTC: 'BTC/USD', ETH: 'ETH/USD', BNB: 'BNB/USD', SOL: 'SOL/USD',
  XRP: 'XRP/USD', ADA: 'ADA/USD', AVAX: 'AVAX/USD', DOT: 'DOT/USD',
  LINK: 'LINK/USD', MATIC: 'MATIC/USD', LTC: 'LTC/USD', BCH: 'BCH/USD',
  ATOM: 'ATOM/USD', UNI: 'UNI/USD', AAVE: 'AAVE/USD', FIL: 'FIL/USD',
  ICP: 'ICP/USD', ALGO: 'ALGO/USD', XLM: 'XLM/USD', VET: 'VET/USD',
};
const CRYPTO_SET = new Set(CRYPTO);

function toTwelveData(ticker: string): string {
  if (CRYPTO_SET.has(ticker)) return CRYPTO_TWELVE_DATA_MAP[ticker] ?? `${ticker}/USD`;
  return ticker;
}

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function isWeekend(): boolean {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}

async function fetchPrice(
  supabase: ReturnType<typeof getServiceSupabase>,
  ticker: string,
  apiKey: string,
): Promise<string> {
  const symbol = toTwelveData(ticker);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=30&apikey=${apiKey}`;
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

  const apiKey = process.env['TWELVE_DATA_API_KEY'];
  if (!apiKey) {
    return NextResponse.json({ error: 'TWELVE_DATA_API_KEY not set' }, { status: 500 });
  }

  const startedAt = new Date().toISOString();
  console.log(`[Cron/Prices] Starting at ${startedAt}`);

  const supabase = getServiceSupabase();

  // On weekends, skip stocks/ETFs (markets closed)
  const weekend = isWeekend();
  const tickers = weekend
    ? [...CRYPTO]
    : [...STOCKS, ...ETFS, ...CRYPTO];

  console.log(`[Cron/Prices] Fetching ${tickers.length} tickers (weekend=${weekend})`);

  let success = 0;
  let failed = 0;
  const errors: string[] = [];

  // Process in batches of 8 with 65s delay (Twelve Data free tier: 8 credits/min)
  const BATCH_SIZE = 8;
  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map((ticker) => fetchPrice(supabase, ticker, apiKey)),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      const ticker = batch[j]!;
      if (result.status === 'fulfilled') {
        if (result.value.startsWith('ok')) {
          success++;
        } else {
          failed++;
          errors.push(`${ticker}: ${result.value}`);
        }
      } else {
        failed++;
        errors.push(`${ticker}: ${result.reason}`);
      }
    }

    if (i + BATCH_SIZE < tickers.length) {
      await new Promise((r) => setTimeout(r, 65_000));
    }
  }

  const completedAt = new Date().toISOString();
  console.log(`[Cron/Prices] Done at ${completedAt}: ${success} success, ${failed} failed`);
  if (errors.length > 0) console.error(`[Cron/Prices] Errors:`, errors.slice(0, 10));

  return NextResponse.json({ startedAt, completedAt, success, failed, errors: errors.slice(0, 20) });
}

export const maxDuration = 300;
