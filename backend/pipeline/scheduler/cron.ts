import cron from 'node-cron';
import { runDailyPipeline, runCryptoPricesOnly } from './daily-pipeline.js';

export function startScheduler(): void {
  // Main daily run: 6pm UTC Mon-Fri (after US market close)
  cron.schedule('0 18 * * 1-5', async () => {
    console.log('[Cron] Triggering daily pipeline run');
    try {
      await runDailyPipeline();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Cron] Daily pipeline failed: ${msg}`);
    }
  });

  // Crypto price update: every 4 hours (crypto trades 24/7)
  cron.schedule('0 */4 * * *', async () => {
    console.log('[Cron] Triggering crypto price update');
    try {
      await runCryptoPricesOnly();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Cron] Crypto price update failed: ${msg}`);
    }
  });

  console.log('[Cron] Scheduler started');
  console.log('[Cron]   Daily pipeline: 0 18 * * 1-5 (6pm UTC Mon-Fri)');
  console.log('[Cron]   Crypto prices:  0 */4 * * * (every 4h)');
}
