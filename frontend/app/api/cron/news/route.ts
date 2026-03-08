import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { STOCKS, ETFS, CRYPTO } from '@shared/lib/constants';

/**
 * GET /api/cron/news
 * GitHub Actions: runs every 6 hours.
 * Fetches latest news from Finnhub for all 100 assets.
 */

const FINNHUB_BASE = 'https://finnhub.io/api/v1';
const REQUEST_DELAY_MS = 350; // ~170 req/min, conservative for free tier

const CRYPTO_KEYWORD_MAP: Record<string, string[]> = {
  BTC: ['bitcoin', 'btc'],
  ETH: ['ethereum', 'eth', 'ether'],
  BNB: ['bnb', 'binance coin'],
  SOL: ['solana', 'sol '],
  XRP: ['xrp', 'ripple'],
  ADA: ['cardano', 'ada '],
  AVAX: ['avalanche', 'avax'],
  DOT: ['polkadot', 'dot '],
  LINK: ['chainlink', 'link '],
  MATIC: ['polygon', 'matic'],
  LTC: ['litecoin', 'ltc'],
  BCH: ['bitcoin cash', 'bch'],
  ATOM: ['cosmos', 'atom '],
  UNI: ['uniswap', 'uni '],
  AAVE: ['aave'],
  FIL: ['filecoin', 'fil '],
  ICP: ['internet computer', 'icp'],
  ALGO: ['algorand', 'algo '],
  XLM: ['stellar', 'xlm'],
  VET: ['vechain', 'vet '],
};

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface FinnhubNewsItem {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

function matchCryptoTickers(headline: string, summary: string | null): string[] {
  const text = `${headline} ${summary ?? ''}`.toLowerCase();
  const matched: string[] = [];
  for (const [ticker, keywords] of Object.entries(CRYPTO_KEYWORD_MAP)) {
    if (keywords.some((kw) => text.includes(kw))) {
      matched.push(ticker);
    }
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

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env['FINNHUB_API_KEY'];
  if (!apiKey) {
    return NextResponse.json({ error: 'FINNHUB_API_KEY not set' }, { status: 500 });
  }

  const startedAt = new Date().toISOString();
  console.log(`[Cron/News] Starting at ${startedAt}`);

  const supabase = getServiceSupabase();
  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const fromStr = formatDate(threeDaysAgo);
  const toStr = formatDate(now);

  let totalInserted = 0;
  const tickerCounts: Record<string, number> = {};
  const errors: string[] = [];

  // 1. Market-wide news
  try {
    const marketNews = await finnhubGet('/news', { category: 'general' }, apiKey);
    const valid = marketNews.filter((n) => n.headline?.trim());
    if (valid.length > 0) {
      const rows = valid.map((n) => ({
        ticker: '_MARKET',
        headline: n.headline,
        summary: n.summary || null,
        source: n.source,
        published_at: new Date(n.datetime * 1000).toISOString(),
        url: n.url,
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
          ticker,
          headline: n.headline,
          summary: n.summary || null,
          source: n.source,
          published_at: new Date(n.datetime * 1000).toISOString(),
          url: n.url,
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

  // 3. Crypto news via /news?category=crypto with keyword matching
  try {
    const cryptoNews = await finnhubGet('/news', { category: 'crypto' }, apiKey);
    const valid = cryptoNews.filter((n) => n.headline?.trim());
    console.log(`[Cron/News] Fetched ${valid.length} crypto news items`);

    const cryptoRows: Array<{
      ticker: string;
      headline: string;
      summary: string | null;
      source: string;
      published_at: string;
      url: string;
    }> = [];

    for (const n of valid) {
      const matched = matchCryptoTickers(n.headline, n.summary);
      if (matched.length > 0) {
        const publishedAt = new Date(n.datetime * 1000).toISOString();
        for (const ticker of matched) {
          cryptoRows.push({
            ticker,
            headline: n.headline,
            summary: n.summary || null,
            source: n.source,
            published_at: publishedAt,
            url: `${n.url}#${ticker}`,
          });
        }
      }
    }

    if (cryptoRows.length > 0) {
      for (let b = 0; b < cryptoRows.length; b += 100) {
        const batch = cryptoRows.slice(b, b + 100);
        const { error } = await supabase.from('news_data').upsert(batch, { onConflict: 'url' });
        if (error) errors.push(`crypto batch: ${error.message}`);
        else {
          for (const row of batch) {
            tickerCounts[row.ticker] = (tickerCounts[row.ticker] ?? 0) + 1;
          }
          totalInserted += batch.length;
        }
      }
    }
  } catch (err: unknown) {
    errors.push(`crypto news: ${err instanceof Error ? err.message : String(err)}`);
  }

  await sleep(REQUEST_DELAY_MS);

  // 4. Company news for major crypto tickers
  const majorCrypto = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'];
  for (const ticker of majorCrypto) {
    try {
      const news = await finnhubGet('/company-news', { symbol: ticker, from: fromStr, to: toStr }, apiKey);
      const valid = news.filter((n) => n.headline?.trim());
      if (valid.length > 0) {
        const rows = valid.map((n) => ({
          ticker,
          headline: n.headline,
          summary: n.summary || null,
          source: n.source,
          published_at: new Date(n.datetime * 1000).toISOString(),
          url: n.url,
        }));
        const { error } = await supabase.from('news_data').upsert(rows, { onConflict: 'url' });
        if (error) errors.push(`${ticker} company: ${error.message}`);
        else { tickerCounts[ticker] = (tickerCounts[ticker] ?? 0) + rows.length; totalInserted += rows.length; }
      }
    } catch {
      // Silently skip — company-news may not support all crypto
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const completedAt = new Date().toISOString();
  const tickersWithNews = Object.keys(tickerCounts).length;
  console.log(`[Cron/News] Done: ${totalInserted} articles for ${tickersWithNews} tickers`);
  if (errors.length > 0) console.log(`[Cron/News] Errors: ${errors.join('; ')}`);

  return NextResponse.json({
    startedAt,
    completedAt,
    totalInserted,
    tickersWithNews,
    tickerCounts,
    errors: errors.slice(0, 20),
  });
}

export const maxDuration = 300;
