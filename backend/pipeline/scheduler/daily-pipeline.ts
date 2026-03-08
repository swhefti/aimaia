import { runPriceIngestion, type IngestionResult } from '../ingestion/price-ingestion.js';
import { runNewsIngestion } from '../ingestion/news-ingestion.js';
import { runFundamentalsIngestion } from '../ingestion/fundamentals-ingestion.js';
import { runMacroEventsIngestion } from '../ingestion/macro-events-ingestion.js';
import { createSupabaseClient } from '../../../shared/lib/supabase.js';

export interface PipelineRunResult {
  priceResult: IngestionResult;
  newsResult: IngestionResult | null;
  fundamentalsResult: IngestionResult | null;
  macroResult: IngestionResult;
  startedAt: string;
  completedAt: string;
}

function logResult(name: string, result: IngestionResult | PromiseSettledResult<IngestionResult>): void {
  if ('status' in result) {
    if (result.status === 'fulfilled') {
      logResult(name, result.value);
    } else {
      console.error(`[Pipeline] ${name} REJECTED: ${result.reason}`);
    }
    return;
  }

  const { success, failed, errors } = result;
  console.log(`[Pipeline] ${name}: ${success} success, ${failed} failed`);
  if (errors.length > 0) {
    console.warn(`[Pipeline] ${name} errors:\n  ${errors.slice(0, 10).join('\n  ')}`);
  }
}

async function writePipelineLog(
  jobName: string,
  startedAt: string,
  result: IngestionResult,
): Promise<void> {
  try {
    const supabase = createSupabaseClient();
    const status = result.failed === 0 && result.errors.length === 0
      ? 'success'
      : result.success > 0
        ? 'partial'
        : 'failure';
    await supabase.from('pipeline_logs').insert({
      job_name: jobName,
      status,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      summary: { success: result.success, failed: result.failed, errorCount: result.errors.length },
      error_message: result.errors.length > 0 ? result.errors.slice(0, 5).join('; ') : null,
    });
  } catch (err) {
    console.error(`[Pipeline] Failed to write pipeline log:`, err);
  }
}

export async function runDailyPipeline(): Promise<PipelineRunResult> {
  const startedAt = new Date().toISOString();
  console.log(`[Pipeline] Starting daily run at ${startedAt}`);

  // 1. Price data — run first, everything else depends on prices
  const priceResult = await runPriceIngestion('all');
  logResult('Price', priceResult);
  await writePipelineLog('daily_full', startedAt, priceResult);

  // 2. News + fundamentals can run in parallel
  const [newsSettled, fundamentalsSettled] = await Promise.allSettled([
    runNewsIngestion(),
    runFundamentalsIngestion(),
  ]);

  logResult('News', newsSettled);
  logResult('Fundamentals', fundamentalsSettled);

  const newsResult = newsSettled.status === 'fulfilled' ? newsSettled.value : null;
  const fundamentalsResult = fundamentalsSettled.status === 'fulfilled' ? fundamentalsSettled.value : null;

  // 3. Macro events — depends on news being ingested first
  const macroResult = await runMacroEventsIngestion();
  logResult('MacroEvents', macroResult);

  const completedAt = new Date().toISOString();
  console.log(`[Pipeline] Daily run complete at ${completedAt}`);

  return { priceResult, newsResult, fundamentalsResult, macroResult, startedAt, completedAt };
}

export async function runPricesOnly(forceAll = false): Promise<IngestionResult> {
  const startedAt = new Date().toISOString();
  console.log('[Pipeline] Running prices only' + (forceAll ? ' (forced all)' : ''));
  const result = await runPriceIngestion('all', forceAll);
  logResult('Price', result);
  await writePipelineLog('prices_all', startedAt, result);
  return result;
}

export async function runCryptoPricesOnly(): Promise<IngestionResult> {
  const startedAt = new Date().toISOString();
  console.log('[Pipeline] Running crypto prices only');
  const result = await runPriceIngestion('crypto-only');
  logResult('CryptoPrice', result);
  await writePipelineLog('crypto_prices', startedAt, result);
  return result;
}

export async function runNewsOnly(): Promise<IngestionResult> {
  const startedAt = new Date().toISOString();
  console.log('[Pipeline] Running news only');
  const result = await runNewsIngestion();
  logResult('News', result);
  await writePipelineLog('news', startedAt, result);
  return result;
}
