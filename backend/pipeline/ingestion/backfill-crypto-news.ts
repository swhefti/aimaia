import { createSupabaseClient } from '../../../shared/lib/supabase.js';
import { CRYPTO } from '../../../shared/lib/constants.js';
import { FinnhubClient } from '../providers/finnhub.js';

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function backfillCryptoNews(days: number = 30): Promise<void> {
  const supabase = createSupabaseClient();
  const client = new FinnhubClient();

  console.log(`[CryptoNewsBackfill] Starting backfill of crypto news for last ${days} days`);

  // 1. Fetch crypto news from Finnhub
  let totalInserted = 0;

  try {
    const cryptoNews = await client.getCryptoNews();
    const validNews = cryptoNews.filter((n) => n.headline && n.headline.trim().length > 0);
    console.log(`[CryptoNewsBackfill] Fetched ${validNews.length} crypto news items from Finnhub`);

    const rows: Array<{
      ticker: string;
      headline: string;
      summary: string | null;
      source: string;
      published_at: string;
      url: string;
    }> = [];

    for (const n of validNews) {
      const matchedTickers = matchCryptoTickers(n.headline, n.summary);
      const publishedAt = new Date(n.datetime * 1000).toISOString();

      if (matchedTickers.length > 0) {
        for (const ticker of matchedTickers) {
          rows.push({
            ticker,
            headline: n.headline,
            summary: n.summary || null,
            source: n.source,
            published_at: publishedAt,
            url: `${n.url}#${ticker}`,
          });
        }
      }
      // Skip unmatched news — _CRYPTO is not in assets table
    }

    // Batch upsert
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      const { error } = await supabase
        .from('news_data')
        .upsert(batch, { onConflict: 'url' });

      if (error) {
        console.error(`[CryptoNewsBackfill] Batch upsert error: ${error.message}`);
      } else {
        totalInserted += batch.length;
      }
    }

    console.log(`[CryptoNewsBackfill] Inserted ${totalInserted} crypto news rows from Finnhub`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[CryptoNewsBackfill] Finnhub crypto news error: ${msg}`);
  }

  // 2. Also try Finnhub /company-news for major crypto tickers
  const now = new Date();
  const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const majorCrypto = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP'];

  for (const ticker of majorCrypto) {
    try {
      await sleep(200);
      const news = await client.getCompanyNews(ticker, startDate, now);
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
        console.error(`[CryptoNewsBackfill] ${ticker} company news error: ${error.message}`);
      } else {
        totalInserted += validNews.length;
        console.log(`[CryptoNewsBackfill] ${ticker}: ${validNews.length} items from company-news`);
      }
    } catch {
      // Silently skip — Finnhub company-news may not support all crypto
    }
  }

  console.log(`[CryptoNewsBackfill] News backfill complete. Total rows: ${totalInserted}`);
  console.log(`[CryptoNewsBackfill] Finnhub API calls: ${client.getRequestCount()}`);

  // 3. Run sentiment scoring for crypto tickers that have news
  console.log(`[CryptoNewsBackfill] Running sentiment scoring for crypto tickers...`);

  // Dynamically import the sentiment agent
  const { run: runSentiment } = await import('../../../agents/sentiment/index.js');

  // Generate dates for last N days
  const dates: Date[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(now);
    date.setDate(date.getDate() - d);
    dates.push(date);
  }

  let sentimentSuccess = 0;
  let sentimentFailed = 0;

  for (const ticker of CRYPTO) {
    // Check if this ticker has any news
    const { count } = await supabase
      .from('news_data')
      .select('*', { count: 'exact', head: true })
      .eq('ticker', ticker);

    if (!count || count === 0) {
      console.log(`[CryptoNewsBackfill] ${ticker}: no news, skipping sentiment`);
      continue;
    }

    console.log(`[CryptoNewsBackfill] ${ticker}: ${count} news items, running sentiment for ${dates.length} dates`);

    for (const date of dates) {
      try {
        await runSentiment(ticker, date);
        sentimentSuccess++;
      } catch (err: unknown) {
        sentimentFailed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[CryptoNewsBackfill] Sentiment failed for ${ticker} on ${date.toISOString().split('T')[0]}: ${msg}`);
      }
      // Brief pause to respect LLM rate limits
      await sleep(500);
    }
  }

  console.log(
    `[CryptoNewsBackfill] Sentiment scoring complete: ${sentimentSuccess} success, ${sentimentFailed} failed`
  );
}
