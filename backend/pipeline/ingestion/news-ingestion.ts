import { createSupabaseClient } from '../../../shared/lib/supabase.js';
import { ASSET_UNIVERSE, CRYPTO, STOCKS, ETFS } from '../../../shared/lib/constants.js';
import { FinnhubClient } from '../providers/finnhub.js';
import type { IngestionResult } from './price-ingestion.js';

// Mapping of keywords to crypto tickers for headline-matching
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

export async function runNewsIngestion(): Promise<IngestionResult> {
  const supabase = createSupabaseClient();
  const client = new FinnhubClient();
  const result: IngestionResult = { success: 0, failed: 0, errors: [] };

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  // 1. Fetch market-wide news
  try {
    const marketNews = await client.getMarketNews();
    const validMarketNews = marketNews.filter((n) => n.headline && n.headline.trim().length > 0);

    if (validMarketNews.length > 0) {
      const rows = validMarketNews.map((n) => ({
        ticker: '_MARKET',
        headline: n.headline,
        summary: n.summary || null,
        source: n.source,
        published_at: new Date(n.datetime * 1000).toISOString(),
        url: n.url,
      }));

      const { error } = await supabase
        .from('news_data')
        .upsert(rows, { onConflict: 'url' });

      if (error) {
        result.errors.push(`Market news: ${error.message}`);
      } else {
        result.success += validMarketNews.length;
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Market news fetch: ${msg}`);
    console.error(`[NewsIngestion] Market news error: ${msg}`);
  }

  // 2. Fetch company news for stocks and ETFs (Finnhub /company-news)
  const stocksAndEtfs = [...STOCKS, ...ETFS];
  for (const ticker of stocksAndEtfs) {
    try {
      const news = await client.getCompanyNews(ticker, threeDaysAgo, now);
      const validNews = news.filter((n) => n.headline && n.headline.trim().length > 0);

      if (validNews.length === 0) continue;

      const rows = validNews.map((n) => ({
        ticker,
        headline: n.headline,
        summary: n.summary || null,
        source: n.source,
        published_at: new Date(n.datetime * 1000).toISOString(),
        url: n.url,
      }));

      const { error } = await supabase
        .from('news_data')
        .upsert(rows, { onConflict: 'url' });

      if (error) {
        result.failed++;
        result.errors.push(`${ticker} news: ${error.message}`);
      } else {
        result.success++;
      }
    } catch (err: unknown) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${ticker}: ${msg}`);
      console.error(`[NewsIngestion] Error for ${ticker}: ${msg}`);
    }
  }

  // 3. Fetch crypto news via Finnhub /news?category=crypto and distribute to tickers
  try {
    const cryptoNews = await client.getCryptoNews();
    const validCryptoNews = cryptoNews.filter((n) => n.headline && n.headline.trim().length > 0);

    console.log(`[NewsIngestion] Fetched ${validCryptoNews.length} crypto news items from Finnhub`);

    const cryptoRows: Array<{
      ticker: string;
      headline: string;
      summary: string | null;
      source: string;
      published_at: string;
      url: string;
    }> = [];

    for (const n of validCryptoNews) {
      const matchedTickers = matchCryptoTickers(n.headline, n.summary);
      const publishedAt = new Date(n.datetime * 1000).toISOString();

      if (matchedTickers.length > 0) {
        // Associate with each matched ticker
        for (const ticker of matchedTickers) {
          cryptoRows.push({
            ticker,
            headline: n.headline,
            summary: n.summary || null,
            source: n.source,
            published_at: publishedAt,
            url: `${n.url}#${ticker}`, // Unique URL per ticker association
          });
        }
      }
      // Skip unmatched crypto news — _CRYPTO is not in assets table
    }

    if (cryptoRows.length > 0) {
      // Batch upsert in chunks of 100
      for (let i = 0; i < cryptoRows.length; i += 100) {
        const batch = cryptoRows.slice(i, i + 100);
        const { error } = await supabase
          .from('news_data')
          .upsert(batch, { onConflict: 'url' });

        if (error) {
          result.errors.push(`Crypto news batch: ${error.message}`);
        } else {
          result.success += batch.length;
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Crypto news fetch: ${msg}`);
    console.error(`[NewsIngestion] Crypto news error: ${msg}`);
  }

  // 4. Also try Finnhub /company-news for major crypto tickers (some may return data)
  const majorCrypto = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'];
  for (const ticker of majorCrypto) {
    try {
      const news = await client.getCompanyNews(ticker, threeDaysAgo, now);
      const validNews = news.filter((n) => n.headline && n.headline.trim().length > 0);

      if (validNews.length === 0) continue;

      const rows = validNews.map((n) => ({
        ticker,
        headline: n.headline,
        summary: n.summary || null,
        source: n.source,
        published_at: new Date(n.datetime * 1000).toISOString(),
        url: n.url,
      }));

      const { error } = await supabase
        .from('news_data')
        .upsert(rows, { onConflict: 'url' });

      if (error) {
        result.errors.push(`${ticker} company news: ${error.message}`);
      } else {
        result.success++;
      }
    } catch {
      // Silently skip — Finnhub company-news may not support all crypto
    }
  }

  console.log(
    `[NewsIngestion] Complete: ${result.success} success, ${result.failed} failed. ` +
    `API calls: ${client.getRequestCount()}`,
  );

  return result;
}
