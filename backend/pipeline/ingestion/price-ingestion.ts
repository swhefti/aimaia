import { createSupabaseClient } from '../../../shared/lib/supabase.js';
import { ASSET_UNIVERSE } from '../../../shared/lib/constants.js';
import { TwelveDataClient } from '../providers/twelve-data.js';
import { toTwelveData, isCrypto } from '../utils/ticker-map.js';

export interface IngestionResult {
  success: number;
  failed: number;
  errors: string[];
}

const BATCH_SIZE = 6;
const BATCH_DELAY_MS = 10_000;

function isWeekend(): boolean {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}

export type PriceScope = 'all' | 'crypto-only';

export async function runPriceIngestion(scope: PriceScope = 'all', forceAll = false): Promise<IngestionResult> {
  const supabase = createSupabaseClient();
  const client = new TwelveDataClient();
  const result: IngestionResult = { success: 0, failed: 0, errors: [] };

  let tickers: string[];
  if (scope === 'crypto-only') {
    tickers = ASSET_UNIVERSE.filter((t) => isCrypto(t));
  } else if (forceAll) {
    tickers = [...ASSET_UNIVERSE];
  } else {
    // On weekends, only fetch crypto (stocks/ETFs markets are closed)
    tickers = isWeekend()
      ? ASSET_UNIVERSE.filter((t) => isCrypto(t))
      : [...ASSET_UNIVERSE];
  }

  console.log(`[PriceIngestion] Fetching prices for ${tickers.length} assets`);

  for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
    const batch = tickers.slice(i, i + BATCH_SIZE);

    for (const ticker of batch) {
      try {
        const providerTicker = toTwelveData(ticker);
        const ohlcvData = await client.getOHLCV(providerTicker, 30);

        // Filter out invalid records
        const validRecords = ohlcvData.filter((d) => d.close !== 0 && !isNaN(d.close));

        if (validRecords.length === 0) {
          result.failed++;
          result.errors.push(`${ticker}: no valid price data returned`);
          continue;
        }

        // Upsert to price_history
        const priceRows = validRecords.map((d) => ({
          ticker,
          date: d.datetime,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume ?? 0,
        }));

        const { error: priceError } = await supabase
          .from('price_history')
          .upsert(priceRows, { onConflict: 'ticker,date' });

        if (priceError) {
          result.failed++;
          result.errors.push(`${ticker} price_history: ${priceError.message}`);
          continue;
        }

        // Upsert latest quote to market_quotes
        const latest = validRecords[0];
        if (latest) {
          const prevClose = validRecords.length > 1 ? validRecords[1]!.close : latest.open;
          const dailyChange = latest.close - prevClose;
          const pctChange = prevClose !== 0 ? dailyChange / prevClose : 0;
          const { error: quoteError } = await supabase
            .from('market_quotes')
            .upsert(
              {
                ticker,
                date: latest.datetime,
                last_price: latest.close,
                daily_change: dailyChange,
                pct_change: pctChange,
              },
              { onConflict: 'ticker,date' },
            );

          if (quoteError) {
            result.errors.push(`${ticker} market_quotes: ${quoteError.message}`);
          }
        }

        result.success++;
      } catch (err: unknown) {
        result.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        result.errors.push(`${ticker}: ${msg}`);
        console.error(`[PriceIngestion] Error for ${ticker}: ${msg}`);
      }
    }

    // Delay between batches to respect rate limits
    if (i + BATCH_SIZE < tickers.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(
    `[PriceIngestion] Complete: ${result.success} success, ${result.failed} failed. ` +
    `API calls: ${client.getRequestCount()}`,
  );

  return result;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
