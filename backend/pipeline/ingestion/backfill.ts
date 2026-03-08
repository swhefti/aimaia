import { createSupabaseClient } from '../../../shared/lib/supabase.js';
import { ASSET_UNIVERSE } from '../../../shared/lib/constants.js';
import { TwelveDataClient } from '../providers/twelve-data.js';
import { toTwelveData } from '../utils/ticker-map.js';

const BATCH_SIZE = 6;
const BATCH_DELAY_MS = 10_000;

export async function backfillPriceHistory(days: number = 200): Promise<void> {
  const supabase = createSupabaseClient();
  const client = new TwelveDataClient();

  let success = 0;
  let failed = 0;

  console.log(`[Backfill] Starting backfill of ${days} days for ${ASSET_UNIVERSE.length} assets`);

  for (let i = 0; i < ASSET_UNIVERSE.length; i += BATCH_SIZE) {
    const batch = ASSET_UNIVERSE.slice(i, i + BATCH_SIZE);

    for (const ticker of batch) {
      try {
        // Check how much data already exists
        const { count } = await supabase
          .from('price_history')
          .select('*', { count: 'exact', head: true })
          .eq('ticker', ticker);

        if (count !== null && count >= days) {
          console.log(`[Backfill] ${ticker}: already has ${count} records, skipping`);
          success++;
          continue;
        }

        const providerTicker = toTwelveData(ticker);
        const ohlcvData = await client.getOHLCV(providerTicker, days);

        // Filter invalid records
        const validRecords = ohlcvData.filter((d) => d.close !== 0 && !isNaN(d.close));

        if (validRecords.length === 0) {
          console.warn(`[Backfill] ${ticker}: no valid data returned`);
          failed++;
          continue;
        }

        const rows = validRecords.map((d) => ({
          ticker,
          date: d.datetime,
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: d.volume,
        }));

        const { error } = await supabase
          .from('price_history')
          .upsert(rows, { onConflict: 'ticker,date' });

        if (error) {
          console.error(`[Backfill] ${ticker}: DB error — ${error.message}`);
          failed++;
        } else {
          console.log(`[Backfill] ${ticker}: ${validRecords.length} days fetched`);
          success++;
        }
      } catch (err: unknown) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Backfill] ${ticker}: ${msg}`);
      }
    }

    // Delay between batches
    if (i + BATCH_SIZE < ASSET_UNIVERSE.length) {
      console.log(`[Backfill] Progress: ${Math.min(i + BATCH_SIZE, ASSET_UNIVERSE.length)}/${ASSET_UNIVERSE.length} — pausing for rate limit...`);
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(
    `[Backfill] Complete: ${success} success, ${failed} failed. ` +
    `API calls: ${client.getRequestCount()}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
