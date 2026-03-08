import { createSupabaseClient } from '../../../shared/lib/supabase.js';
import { STOCKS, ETFS } from '../../../shared/lib/constants.js';
import { FinnhubClient } from '../providers/finnhub.js';
import type { IngestionResult } from './price-ingestion.js';

const STALENESS_DAYS = 7;

export async function runFundamentalsIngestion(): Promise<IngestionResult> {
  const supabase = createSupabaseClient();
  const client = new FinnhubClient();
  const result: IngestionResult = { success: 0, failed: 0, errors: [] };

  // Fundamentals only for stocks and ETFs — skip crypto
  const tickers = [...STOCKS, ...ETFS];
  const today = new Date().toISOString().split('T')[0]!;
  const staleThreshold = new Date(Date.now() - STALENESS_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0]!;

  console.log(`[FundamentalsIngestion] Checking ${tickers.length} tickers (stale threshold: ${staleThreshold})`);

  for (const ticker of tickers) {
    try {
      // Staleness check: skip if we have recent data
      const { data: existing } = await supabase
        .from('fundamental_data')
        .select('date')
        .eq('ticker', ticker)
        .gte('date', staleThreshold)
        .limit(1);

      if (existing && existing.length > 0) {
        continue; // Fresh enough, skip
      }

      const fundamentals = await client.getFundamentals(ticker);

      const { error } = await supabase
        .from('fundamental_data')
        .upsert(
          {
            ticker,
            date: today,
            pe_ratio: fundamentals.peRatio,
            ps_ratio: fundamentals.psRatio,
            revenue_growth_yoy: fundamentals.revenueGrowthYoy,
            profit_margin: fundamentals.profitMargin,
            roe: fundamentals.roe,
            market_cap: fundamentals.marketCap,
            debt_to_equity: fundamentals.debtToEquity,
          },
          { onConflict: 'ticker,date' },
        );

      if (error) {
        result.failed++;
        result.errors.push(`${ticker}: ${error.message}`);
      } else {
        result.success++;
      }
    } catch (err: unknown) {
      result.failed++;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${ticker}: ${msg}`);
      console.error(`[FundamentalsIngestion] Error for ${ticker}: ${msg}`);
    }
  }

  console.log(
    `[FundamentalsIngestion] Complete: ${result.success} fetched, ${result.failed} failed. ` +
    `API calls: ${client.getRequestCount()}`,
  );

  return result;
}
