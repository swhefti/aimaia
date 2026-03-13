#!/usr/bin/env npx tsx
/**
 * Job: Ingest news from Finnhub for all 100 assets.
 * Usage: npx tsx backend/jobs/news.ts
 */
import { loadEnv } from './lib/env.js';
loadEnv();

import { getServiceSupabase } from './lib/supabase.js';
import { STOCKS, ETFS } from '../../shared/lib/constants.js';

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const REQUEST_DELAY_MS = 350;

const CRYPTO_KEYWORD_MAP: Record<string, string[]> = {
  BTC: ['bitcoin', 'btc'], ETH: ['ethereum', 'eth', 'ether'],
  BNB: ['bnb', 'binance coin'], SOL: ['solana', 'sol '],
  XRP: ['xrp', 'ripple'], ADA: ['cardano', 'ada '],
  AVAX: ['avalanche', 'avax'], DOT: ['polkadot', 'dot '],
  LINK: ['chainlink', 'link '], MATIC: ['polygon', 'matic'],
  LTC: ['litecoin', 'ltc'], BCH: ['bitcoin cash', 'bch'],
  ATOM: ['cosmos', 'atom '], UNI: ['uniswap', 'uni '],
  AAVE: ['aave'], FIL: ['filecoin', 'fil '],
  ICP: ['internet computer', 'icp'], ALGO: ['algorand', 'algo '],
  XLM: ['stellar', 'xlm'], VET: ['vechain', 'vet '],
};

function formatDate(d: Date): string { return d.toISOString().split('T')[0]!; }
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

interface FinnhubNewsItem {
  id: number; category: string; datetime: number; headline: string;
  image: string; related: string; source: string; summary: string; url: string;
}

function matchCryptoTickers(headline: string, summary: string | null): string[] {
  const text = `${headline} ${summary ?? ''}`.toLowerCase();
  const matched: string[] = [];
  for (const [ticker, keywords] of Object.entries(CRYPTO_KEYWORD_MAP)) {
    if (keywords.some((kw) => text.includes(kw))) matched.push(ticker);
  }
  return matched;
}

async function finnhubGet(path: string, params: Record<string, string>, apiKey: string): Promise<FinnhubNewsItem[]> {
  const qs = new URLSearchParams({ ...params, token: apiKey }).toString();
  const resp = await fetch(`${FINNHUB_BASE}${path}?${qs}`, { signal: AbortSignal.timeout(30_000) });
  if (resp.status === 429) {
    await sleep(5_000);
    const retry = await fetch(`${FINNHUB_BASE}${path}?${qs}`, { signal: AbortSignal.timeout(30_000) });
    if (!retry.ok) return [];
    const data = await retry.json();
    return Array.isArray(data) ? data : [];
  }
  if (!resp.ok) return [];
  const data = await resp.json();
  return Array.isArray(data) ? data : [];
}

async function main(): Promise<void> {
  const apiKey = process.env['FINNHUB_API_KEY'];
  if (!apiKey) { console.error('FINNHUB_API_KEY not set'); process.exit(1); }

  const supabase = getServiceSupabase();
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const fromStr = formatDate(threeDaysAgo);
  const toStr = formatDate(now);

  let totalInserted = 0;
  const tickerCounts: Record<string, number> = {};
  const errors: string[] = [];

  console.log(`[News] Starting: ${fromStr} to ${toStr}`);

  // 1. Market-wide news
  try {
    const marketNews = await finnhubGet('/news', { category: 'general' }, apiKey);
    const valid = marketNews.filter((n) => n.headline?.trim());
    if (valid.length > 0) {
      const rows = valid.map((n) => ({
        ticker: '_MARKET', headline: n.headline, summary: n.summary || null,
        source: n.source, published_at: new Date(n.datetime * 1000).toISOString(), url: n.url,
      }));
      const { error, count } = await supabase.from('news_data').upsert(rows, { onConflict: 'url', count: 'exact' });
      if (error) errors.push(`_MARKET: ${error.message}`);
      else { tickerCounts['_MARKET'] = count ?? rows.length; totalInserted += count ?? rows.length; }
    }
  } catch (err: unknown) {
    errors.push(`_MARKET: ${err instanceof Error ? err.message : String(err)}`);
  }
  await sleep(REQUEST_DELAY_MS);

  // 2. Company news for stocks and ETFs
  const stocksAndEtfs = [...STOCKS, ...ETFS];
  for (let i = 0; i < stocksAndEtfs.length; i++) {
    const ticker = stocksAndEtfs[i]!;
    try {
      const news = await finnhubGet('/company-news', { symbol: ticker, from: fromStr, to: toStr }, apiKey);
      const valid = news.filter((n) => n.headline?.trim());
      if (valid.length > 0) {
        const rows = valid.map((n) => ({
          ticker, headline: n.headline, summary: n.summary || null,
          source: n.source, published_at: new Date(n.datetime * 1000).toISOString(), url: n.url,
        }));
        for (let b = 0; b < rows.length; b += 100) {
          const batch = rows.slice(b, b + 100);
          const { error } = await supabase.from('news_data').upsert(batch, { onConflict: 'url' });
          if (error) errors.push(`${ticker}: ${error.message}`);
          else { tickerCounts[ticker] = (tickerCounts[ticker] ?? 0) + batch.length; totalInserted += batch.length; }
        }
      }
    } catch (err: unknown) {
      errors.push(`${ticker}: ${err instanceof Error ? err.message : String(err)}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  // 3. Crypto news via /news?category=crypto
  try {
    const cryptoNews = await finnhubGet('/news', { category: 'crypto' }, apiKey);
    const valid = cryptoNews.filter((n) => n.headline?.trim());
    console.log(`[News] Fetched ${valid.length} crypto news items`);

    const cryptoRows: Array<{ ticker: string; headline: string; summary: string | null; source: string; published_at: string; url: string }> = [];
    for (const n of valid) {
      const matched = matchCryptoTickers(n.headline, n.summary);
      if (matched.length > 0) {
        const publishedAt = new Date(n.datetime * 1000).toISOString();
        for (const ticker of matched) {
          cryptoRows.push({ ticker, headline: n.headline, summary: n.summary || null, source: n.source, published_at: publishedAt, url: `${n.url}#${ticker}` });
        }
      }
    }
    if (cryptoRows.length > 0) {
      for (let b = 0; b < cryptoRows.length; b += 100) {
        const batch = cryptoRows.slice(b, b + 100);
        const { error } = await supabase.from('news_data').upsert(batch, { onConflict: 'url' });
        if (error) errors.push(`crypto batch: ${error.message}`);
        else {
          for (const row of batch) tickerCounts[row.ticker] = (tickerCounts[row.ticker] ?? 0) + 1;
          totalInserted += batch.length;
        }
      }
    }
  } catch (err: unknown) {
    errors.push(`crypto news: ${err instanceof Error ? err.message : String(err)}`);
  }
  await sleep(REQUEST_DELAY_MS);

  // 4. Company news for major crypto
  const majorCrypto = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'];
  for (const ticker of majorCrypto) {
    try {
      const news = await finnhubGet('/company-news', { symbol: ticker, from: fromStr, to: toStr }, apiKey);
      const valid = news.filter((n) => n.headline?.trim());
      if (valid.length > 0) {
        const rows = valid.map((n) => ({
          ticker, headline: n.headline, summary: n.summary || null,
          source: n.source, published_at: new Date(n.datetime * 1000).toISOString(), url: n.url,
        }));
        const { error } = await supabase.from('news_data').upsert(rows, { onConflict: 'url' });
        if (error) errors.push(`${ticker} company: ${error.message}`);
        else { tickerCounts[ticker] = (tickerCounts[ticker] ?? 0) + rows.length; totalInserted += rows.length; }
      }
    } catch { /* silently skip */ }
    await sleep(REQUEST_DELAY_MS);
  }

  const tickersWithNews = Object.keys(tickerCounts).length;
  console.log(`[News] Done: ${totalInserted} articles for ${tickersWithNews} tickers`);
  if (errors.length > 0) console.log(`[News] Errors (${errors.length}): ${errors.slice(0, 10).join('; ')}`);
}

main().catch((err) => { console.error('[News] Fatal:', err); process.exit(1); });
