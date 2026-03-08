import 'dotenv/config';
import { runDailyPipeline, runPricesOnly, runCryptoPricesOnly, runNewsOnly } from './scheduler/daily-pipeline.js';
import { backfillPriceHistory } from './ingestion/backfill.js';
import { backfillCryptoNews } from './ingestion/backfill-crypto-news.js';
import { generateConclusions } from './ingestion/conclusion-generation.js';
import { startScheduler } from './scheduler/cron.js';

type RunMode = 'full' | 'prices-only' | 'crypto-prices-only' | 'news-only' | 'backfill' | 'backfill-crypto-news' | 'conclusions' | 'scheduler';

function parseArgs(): { mode: RunMode; days: number | undefined; forceAll: boolean } {
  const args = process.argv.slice(2);
  let mode: RunMode = 'full';
  let days: number | undefined;
  let forceAll = false;

  for (const arg of args) {
    if (arg.startsWith('--mode=')) {
      mode = arg.split('=')[1] as RunMode;
    }
    if (arg.startsWith('--days=')) {
      days = parseInt(arg.split('=')[1]!, 10);
    }
    if (arg === '--force-all') {
      forceAll = true;
    }
  }

  return { mode, days, forceAll };
}

async function main(): Promise<void> {
  const { mode, days, forceAll } = parseArgs();

  console.log(`[Run] Mode: ${mode}`);

  switch (mode) {
    case 'full':
      await runDailyPipeline();
      break;

    case 'prices-only':
      await runPricesOnly(forceAll);
      break;

    case 'crypto-prices-only':
      await runCryptoPricesOnly();
      break;

    case 'news-only':
      await runNewsOnly();
      break;

    case 'backfill':
      await backfillPriceHistory(days ?? 200);
      break;

    case 'backfill-crypto-news':
      await backfillCryptoNews(days ?? 30);
      break;

    case 'conclusions':
      await generateConclusions();
      break;

    case 'scheduler':
      startScheduler();
      // Keep process alive
      console.log('[Run] Scheduler running. Press Ctrl+C to stop.');
      return;

    default:
      console.error(`Unknown mode: ${mode}`);
      console.error('Usage: node run.js --mode=full|prices-only|crypto-prices-only|news-only|backfill|backfill-crypto-news|conclusions|scheduler [--days=200]');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('[Run] Fatal error:', err);
  process.exit(1);
});
