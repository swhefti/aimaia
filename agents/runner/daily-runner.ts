import { ASSET_UNIVERSE } from '../../shared/lib/constants.js';
import { createSupabaseClient } from '../../shared/lib/supabase.js';
import * as technicalAgent from '../technical/index.js';
import * as fundamentalAgent from '../fundamental/index.js';
import * as regimeAgent from '../regime/index.js';
import * as sentimentAgent from '../sentiment/index.js';
import { runSynthesisForPortfolio } from '../synthesis/index.js';

async function getActivePortfolios(): Promise<Array<{ id: string; userId: string }>> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from('portfolios')
    .select('id, user_id')
    .eq('status', 'active');

  if (error) {
    console.error('[Runner] Failed to fetch active portfolios:', error.message);
    return [];
  }

  return (data ?? []).map((p) => ({
    id: p.id as string,
    userId: p.user_id as string,
  }));
}

export async function runDailyAnalysis(date: Date): Promise<void> {
  console.log(`[Agents] Starting daily analysis for ${date.toISOString()}`);

  const tickers = [...ASSET_UNIVERSE];

  // Step 1: Run deterministic math agents in parallel
  console.log(`[Agents] Running Technical + Fundamental agents on ${tickers.length} assets...`);
  await Promise.all([
    technicalAgent.runBatch(tickers, date),
    fundamentalAgent.runBatch(tickers, date),
  ]);

  // Step 2: Run regime agent (once, not per ticker)
  console.log('[Agents] Running Market Regime agent...');
  await regimeAgent.run(date);

  // Step 3: Run sentiment agent (batched, has LLM calls)
  console.log(`[Agents] Running Sentiment agent on ${tickers.length} assets...`);
  await sentimentAgent.runBatch(tickers, date);

  // Step 4: Run synthesis for each active user portfolio
  console.log('[Agents] Running Synthesis for active portfolios...');
  const activePortfolios = await getActivePortfolios();

  for (const portfolio of activePortfolios) {
    await runSynthesisForPortfolio(portfolio.id, portfolio.userId, date);
  }

  console.log(`[Agents] Daily analysis complete. Processed ${tickers.length} assets, ${activePortfolios.length} portfolios.`);
}
