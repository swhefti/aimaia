import type { AgentScore } from '../../shared/types/scores.js';
import { createSupabaseClient } from '../../shared/lib/supabase.js';
import { ASSET_TYPE_MAP } from '../../shared/lib/constants.js';

const AGENT_VERSION = '1.0.0';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Hardcoded sector median P/E ratios for MVP
const SECTOR_MEDIAN_PE: Record<string, number> = {
  technology: 28,
  healthcare: 22,
  financials: 14,
  'consumer cyclical': 20,
  'consumer defensive': 24,
  industrials: 18,
  energy: 12,
  'real estate': 30,
  utilities: 18,
  'communication services': 20,
  'basic materials': 15,
  default: 20,
};

function scorePE(peRatio: number | null, sector: string): number {
  if (peRatio === null) return 0;
  if (peRatio < 0) return -0.4; // Loss-making
  const medianPE = SECTOR_MEDIAN_PE[sector?.toLowerCase() ?? 'default'] ?? SECTOR_MEDIAN_PE['default']!;
  const ratio = peRatio / medianPE;
  if (ratio < 0.5) return 0.5;
  if (ratio < 0.8) return 0.3;
  if (ratio < 1.2) return 0.0;
  if (ratio < 1.5) return -0.2;
  return -0.4;
}

function scoreRevenueGrowth(growthPct: number | null): number {
  if (growthPct === null) return 0;
  if (growthPct > 0.20) return 0.5;
  if (growthPct > 0.10) return 0.3;
  if (growthPct > 0) return 0.1;
  return -0.4;
}

function scoreMargin(margin: number | null): number {
  if (margin === null) return 0;
  if (margin > 0.20) return 0.3;
  if (margin > 0.05) return 0.1;
  if (margin >= 0) return 0;
  return -0.3;
}

function scoreROE(roe: number | null): number {
  if (roe === null) return 0;
  if (roe > 0.20) return 0.3;
  if (roe > 0.10) return 0.1;
  if (roe >= 0) return 0;
  return -0.4;
}

function scoreDebt(debtToEquity: number | null): number {
  if (debtToEquity === null) return 0;
  if (debtToEquity > 3) return -0.3;
  if (debtToEquity > 1) return -0.1;
  return 0.1;
}

function computeFundamentalScore(
  data: { peRatio: number | null; revenueGrowthYoy: number | null; profitMargin: number | null; roe: number | null; debtToEquity: number | null },
  sector: string
): { score: number; confidence: number; components: Record<string, number> } {
  const peScore = scorePE(data.peRatio, sector);
  const revenueScore = scoreRevenueGrowth(data.revenueGrowthYoy);
  const marginScore = scoreMargin(data.profitMargin);
  const roeScore = scoreROE(data.roe);
  const debtScore = scoreDebt(data.debtToEquity);

  const score = clamp(
    peScore * 0.25 + revenueScore * 0.25 + marginScore * 0.15 + roeScore * 0.20 + debtScore * 0.15,
    -1,
    1
  );

  // Confidence based on how many metrics are available
  const available = [data.peRatio, data.revenueGrowthYoy, data.profitMargin, data.roe, data.debtToEquity].filter(
    (v) => v !== null
  ).length;
  const confidence = clamp(0.3 + (available / 5) * 0.5, 0, 1);

  return {
    score,
    confidence,
    components: { peScore, revenueScore, marginScore, roeScore, debtScore },
  };
}

export async function run(ticker: string, date: Date): Promise<AgentScore> {
  const supabase = createSupabaseClient();
  const dateStr = date.toISOString().split('T')[0]!;
  const assetType = ASSET_TYPE_MAP[ticker];

  // Crypto: fundamentals not applicable
  if (assetType === 'crypto') {
    const agentScore: AgentScore = {
      ticker,
      date: dateStr,
      agentType: 'fundamental',
      score: 0,
      confidence: 0.1,
      componentScores: {},
      explanation: 'Fundamental metrics not applicable to crypto assets.',
      dataFreshness: 'missing',
      agentVersion: AGENT_VERSION,
    };
    await writeToDB(supabase, agentScore);
    return agentScore;
  }

  // ETF: simplified scoring
  if (assetType === 'etf') {
    const agentScore: AgentScore = {
      ticker,
      date: dateStr,
      agentType: 'fundamental',
      score: 0,
      confidence: 0.3,
      componentScores: { etfDefault: 0 },
      explanation: 'ETF fundamental scoring uses simplified metrics. Neutral baseline.',
      dataFreshness: 'current',
      agentVersion: AGENT_VERSION,
    };
    await writeToDB(supabase, agentScore);
    return agentScore;
  }

  // Stock: full fundamental analysis
  const { data: fundData, error } = await supabase
    .from('fundamental_data')
    .select('pe_ratio, revenue_growth_yoy, profit_margin, roe, debt_to_equity, date')
    .eq('ticker', ticker)
    .lte('date', dateStr)
    .order('date', { ascending: false })
    .limit(1)
    .single();

  if (error || !fundData) {
    const agentScore: AgentScore = {
      ticker,
      date: dateStr,
      agentType: 'fundamental',
      score: 0,
      confidence: 0.1,
      componentScores: {},
      explanation: 'No fundamental data available.',
      dataFreshness: 'missing',
      agentVersion: AGENT_VERSION,
    };
    await writeToDB(supabase, agentScore);
    return agentScore;
  }

  // Check data freshness (>90 days old = stale)
  const dataDate = new Date(fundData.date as string);
  const daysDiff = Math.floor((date.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24));
  const freshness = daysDiff > 90 ? 'stale' : 'current';

  // Fetch sector for P/E comparison
  const { data: assetInfo } = await supabase
    .from('assets')
    .select('sector')
    .eq('ticker', ticker)
    .single();

  const { score, confidence, components } = computeFundamentalScore(
    {
      peRatio: fundData.pe_ratio as number | null,
      revenueGrowthYoy: fundData.revenue_growth_yoy as number | null,
      profitMargin: fundData.profit_margin as number | null,
      roe: fundData.roe as number | null,
      debtToEquity: fundData.debt_to_equity as number | null,
    },
    (assetInfo?.sector as string) ?? 'N/A'
  );

  const adjustedConfidence = freshness === 'stale' ? Math.min(confidence, 0.3) : confidence;

  const agentScore: AgentScore = {
    ticker,
    date: dateStr,
    agentType: 'fundamental',
    score,
    confidence: adjustedConfidence,
    componentScores: components,
    explanation: `Fundamental score ${score.toFixed(2)} (P/E=${components['peScore']?.toFixed(2)}, Revenue=${components['revenueScore']?.toFixed(2)}, Margin=${components['marginScore']?.toFixed(2)}, ROE=${components['roeScore']?.toFixed(2)}, Debt=${components['debtScore']?.toFixed(2)})`,
    dataFreshness: freshness,
    agentVersion: AGENT_VERSION,
  };

  await writeToDB(supabase, agentScore);
  return agentScore;
}

async function writeToDB(supabase: ReturnType<typeof createSupabaseClient>, agentScore: AgentScore): Promise<void> {
  const { error } = await supabase.from('agent_scores').upsert(
    {
      ticker: agentScore.ticker,
      date: agentScore.date,
      agent_type: agentScore.agentType,
      score: agentScore.score,
      confidence: agentScore.confidence,
      component_scores: agentScore.componentScores,
      explanation: agentScore.explanation,
      data_freshness: agentScore.dataFreshness,
      agent_version: agentScore.agentVersion,
    },
    { onConflict: 'ticker,date,agent_type' }
  );

  if (error) {
    console.error(`[Fundamental] Upsert error for ${agentScore.ticker}:`, error.message);
  }
}

export async function runBatch(tickers: string[], date: Date): Promise<AgentScore[]> {
  const results: AgentScore[] = [];
  for (const ticker of tickers) {
    try {
      const result = await run(ticker, date);
      results.push(result);
    } catch (err) {
      console.error(`[Fundamental] Failed for ${ticker}:`, err);
    }
  }
  return results;
}
