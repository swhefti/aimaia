#!/usr/bin/env npx tsx
/**
 * Job: Ingest stock/ETF prices from Twelve Data.
 * Runs on weekdays for all stocks+ETFs+crypto, weekends crypto-only.
 * Usage: npx tsx backend/jobs/prices.ts
 */
import { loadEnv } from './lib/env.js';
loadEnv();

import { getServiceSupabase } from './lib/supabase.js';
import { STOCKS, ETFS, CRYPTO } from '../../shared/lib/constants.js';

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

function isWeekend(): boolean {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

async function fetchPrice(ticker: string, apiKey: string): Promise<string> {
  const supabase = getServiceSupabase();
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
      ticker, date: d.datetime,
      open: parseFloat(d.open), high: parseFloat(d.high),
      low: parseFloat(d.low), close: parseFloat(d.close),
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

async function main(): Promise<void> {
  const apiKey = process.env['TWELVE_DATA_API_KEY'];
  if (!apiKey) { console.error('TWELVE_DATA_API_KEY not set'); process.exit(1); }

  const weekend = isWeekend();
  const tickers = weekend ? [...CRYPTO] : [...STOCKS, ...ETFS, ...CRYPTO];
  console.log(`[Prices] Starting: ${tickers.length} tickers (weekend=${weekend})`);

  let success = 0, errors = 0;
  for (const ticker of tickers) {
    try {
      const result = await fetchPrice(ticker, apiKey);
      const ok = result.startsWith('ok');
      console.log(`  ${ticker}: ${result}`);
      if (ok) success++; else errors++;
    } catch (err) {
      console.error(`  ${ticker}: ${err instanceof Error ? err.message : err}`);
      errors++;
    }
    await sleep(7_000); // Rate limit: ~8 req/min
  }

  console.log(`[Prices] Done: ${success} success, ${errors} errors`);
  if (errors > tickers.length * 0.5) process.exit(1);
}

main().catch((err) => { console.error('[Prices] Fatal:', err); process.exit(1); });
