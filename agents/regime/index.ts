import type { AgentScore } from '../../shared/types/scores.js';
import type { MarketRegimeLabel } from '../../shared/types/synthesis.js';
import { createSupabaseClient } from '../../shared/lib/supabase.js';

const AGENT_VERSION = '1.1.0';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function calculateEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prev = closes[0]!;
  ema.push(prev);
  for (let i = 1; i < closes.length; i++) {
    prev = closes[i]! * k + prev * (1 - k);
    ema.push(prev);
  }
  return ema;
}

function calculateRealizedVolatility(closes: number[], window = 20): number {
  if (closes.length < window + 1) return 0;
  const returns: number[] = [];
  const slice = closes.slice(-(window + 1));
  for (let i = 1; i < slice.length; i++) {
    returns.push(Math.log(slice[i]! / slice[i - 1]!));
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(365); // Annualized (365 for crypto)
}

function calculateRealizedVolatilityEquity(closes: number[], window = 20): number {
  if (closes.length < window + 1) return 0;
  const returns: number[] = [];
  const slice = closes.slice(-(window + 1));
  for (let i = 1; i < slice.length; i++) {
    returns.push(Math.log(slice[i]! / slice[i - 1]!));
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(252); // Annualized (252 trading days)
}

function scoreTrend(price: number, ema50: number, ema200: number): number {
  let score = 0;
  if (price > ema50) score += 0.4;
  else score -= 0.4;
  if (ema50 > ema200) score += 0.4;
  else score -= 0.4;
  const distPct = (price - ema50) / ema50;
  score += clamp(distPct * 2, -0.2, 0.2);
  return clamp(score, -1, 1);
}

function scoreVolatility(annualizedVol: number, thresholds: { low: number; normal: number; elevated: number }): number {
  if (annualizedVol < thresholds.low) return 0.5;
  if (annualizedVol < thresholds.normal) return 0.3;
  if (annualizedVol < thresholds.elevated) return 0.0;
  if (annualizedVol < thresholds.elevated * 1.5) return -0.3;
  return -0.6;
}

function getVolatilityLevel(annualizedVol: number, thresholds: { low: number; normal: number; elevated: number }): 'low' | 'normal' | 'elevated' | 'extreme' {
  if (annualizedVol < thresholds.low) return 'low';
  if (annualizedVol < thresholds.elevated) return 'normal';
  if (annualizedVol < thresholds.elevated * 1.5) return 'elevated';
  return 'extreme';
}

function getRegimeLabel(score: number): MarketRegimeLabel {
  if (score > 0.4) return 'bullish';
  if (score > 0.1) return 'neutral';
  if (score > -0.3) return 'cautious';
  return 'bearish';
}

function getBroadTrend(trendScore: number): 'strengthening' | 'stable' | 'weakening' {
  if (trendScore > 0.3) return 'strengthening';
  if (trendScore > -0.3) return 'stable';
  return 'weakening';
}

function getSectorRotation(xlkReturn: number, xlvReturn: number): 'growth' | 'balanced' | 'defensive' {
  const diff = xlkReturn - xlvReturn;
  if (diff > 0.02) return 'growth';
  if (diff < -0.02) return 'defensive';
  return 'balanced';
}

export interface RegimeOutput {
  regimeScore: number;
  regimeLabel: MarketRegimeLabel;
  volatilityLevel: 'low' | 'normal' | 'elevated' | 'extreme';
  broadTrend: 'strengthening' | 'stable' | 'weakening';
  sectorRotation: 'growth' | 'balanced' | 'defensive';
  regimeConfidence: number;
}

async function fetchCloses(supabase: ReturnType<typeof createSupabaseClient>, ticker: string, dateStr: string, limit = 250): Promise<number[]> {
  const { data, error } = await supabase
    .from('price_history')
    .select('close')
    .eq('ticker', ticker)
    .lte('date', dateStr)
    .order('date', { ascending: true })
    .limit(limit);

  if (error) {
    console.error(`[Regime] DB error fetching ${ticker}:`, error.message);
    return [];
  }
  return (data ?? []).map((r) => Number(r.close));
}

// Stock/ETF volatility thresholds (based on SPY)
const EQUITY_VOL_THRESHOLDS = { low: 0.10, normal: 0.15, elevated: 0.20 };

// Crypto volatility thresholds (crypto is inherently more volatile)
const CRYPTO_VOL_THRESHOLDS = { low: 0.40, normal: 0.60, elevated: 0.80 };

async function runStockRegime(supabase: ReturnType<typeof createSupabaseClient>, dateStr: string): Promise<AgentScore> {
  const [spyCloses, xlkCloses, xlvCloses] = await Promise.all([
    fetchCloses(supabase, 'SPY', dateStr),
    fetchCloses(supabase, 'XLK', dateStr),
    fetchCloses(supabase, 'XLV', dateStr),
  ]);

  if (spyCloses.length < 50) {
    return {
      ticker: 'MARKET',
      date: dateStr,
      agentType: 'market_regime',
      score: 0,
      confidence: 0.1,
      componentScores: {},
      explanation: 'Insufficient SPY data for stock market regime analysis.',
      dataFreshness: 'missing',
      agentVersion: AGENT_VERSION,
    };
  }

  const spyEma50 = calculateEMA(spyCloses, 50);
  const spyEma200 = calculateEMA(spyCloses, 200);
  const spyPrice = spyCloses[spyCloses.length - 1]!;
  const spyTrendScore = scoreTrend(spyPrice, spyEma50[spyEma50.length - 1]!, spyEma200[spyEma200.length - 1]!);

  const annualizedVol = calculateRealizedVolatilityEquity(spyCloses);
  const volatilityScore = scoreVolatility(annualizedVol, EQUITY_VOL_THRESHOLDS);

  let sectorRotationScore = 0;
  let sectorRotation: 'growth' | 'balanced' | 'defensive' = 'balanced';
  if (xlkCloses.length >= 21 && xlvCloses.length >= 21) {
    const xlkReturn = (xlkCloses[xlkCloses.length - 1]! - xlkCloses[xlkCloses.length - 21]!) / xlkCloses[xlkCloses.length - 21]!;
    const xlvReturn = (xlvCloses[xlvCloses.length - 1]! - xlvCloses[xlvCloses.length - 21]!) / xlvCloses[xlvCloses.length - 21]!;
    sectorRotation = getSectorRotation(xlkReturn, xlvReturn);
    sectorRotationScore = sectorRotation === 'growth' ? 0.3 : sectorRotation === 'defensive' ? -0.3 : 0;
  }

  const regimeScore = clamp(
    spyTrendScore * 0.50 + volatilityScore * 0.30 + sectorRotationScore * 0.20,
    -1,
    1
  );

  const regimeLabel = getRegimeLabel(regimeScore);
  const volatilityLevel = getVolatilityLevel(annualizedVol, EQUITY_VOL_THRESHOLDS);
  const broadTrend = getBroadTrend(spyTrendScore);
  const confidence = spyCloses.length >= 200 ? 0.8 : 0.5;

  return {
    ticker: 'MARKET',
    date: dateStr,
    agentType: 'market_regime',
    score: regimeScore,
    confidence,
    componentScores: {
      spyTrendScore,
      volatilityScore,
      sectorRotationScore,
      annualizedVol,
    } as Record<string, number>,
    explanation: `Stock market regime: ${regimeLabel} (score=${regimeScore.toFixed(2)}). Volatility: ${volatilityLevel}. Trend: ${broadTrend}. Sector rotation: ${sectorRotation}.`,
    dataFreshness: 'current',
    agentVersion: AGENT_VERSION,
  };
}

async function runCryptoRegime(supabase: ReturnType<typeof createSupabaseClient>, dateStr: string): Promise<AgentScore> {
  const [btcCloses, ethCloses] = await Promise.all([
    fetchCloses(supabase, 'BTC', dateStr),
    fetchCloses(supabase, 'ETH', dateStr),
  ]);

  if (btcCloses.length < 50) {
    return {
      ticker: 'MARKET_CRYPTO',
      date: dateStr,
      agentType: 'market_regime',
      score: 0,
      confidence: 0.1,
      componentScores: {},
      explanation: 'Insufficient BTC data for crypto market regime analysis.',
      dataFreshness: 'missing',
      agentVersion: AGENT_VERSION,
    };
  }

  // BTC trend (primary crypto market indicator)
  const btcEma50 = calculateEMA(btcCloses, 50);
  const btcEma200 = calculateEMA(btcCloses, 200);
  const btcPrice = btcCloses[btcCloses.length - 1]!;
  const btcTrendScore = scoreTrend(btcPrice, btcEma50[btcEma50.length - 1]!, btcEma200[btcEma200.length - 1]!);

  // BTC volatility
  const annualizedVol = calculateRealizedVolatility(btcCloses);
  const volatilityScore = scoreVolatility(annualizedVol, CRYPTO_VOL_THRESHOLDS);

  // ETH/BTC rotation: ETH outperforming BTC = risk-on (altcoin season)
  let altSeasonScore = 0;
  if (ethCloses.length >= 21 && btcCloses.length >= 21) {
    const ethReturn = (ethCloses[ethCloses.length - 1]! - ethCloses[ethCloses.length - 21]!) / ethCloses[ethCloses.length - 21]!;
    const btcReturn = (btcCloses[btcCloses.length - 1]! - btcCloses[btcCloses.length - 21]!) / btcCloses[btcCloses.length - 21]!;
    const diff = ethReturn - btcReturn;
    altSeasonScore = clamp(diff * 3, -0.3, 0.3); // ETH outperformance = risk-on
  }

  const regimeScore = clamp(
    btcTrendScore * 0.50 + volatilityScore * 0.25 + altSeasonScore * 0.25,
    -1,
    1
  );

  const regimeLabel = getRegimeLabel(regimeScore);
  const volatilityLevel = getVolatilityLevel(annualizedVol, CRYPTO_VOL_THRESHOLDS);
  const broadTrend = getBroadTrend(btcTrendScore);
  const confidence = btcCloses.length >= 200 ? 0.75 : 0.4;

  return {
    ticker: 'MARKET_CRYPTO',
    date: dateStr,
    agentType: 'market_regime',
    score: regimeScore,
    confidence,
    componentScores: {
      btcTrendScore,
      volatilityScore,
      altSeasonScore,
      annualizedVol,
    } as Record<string, number>,
    explanation: `Crypto market regime: ${regimeLabel} (score=${regimeScore.toFixed(2)}). Volatility: ${volatilityLevel}. Trend: ${broadTrend}. Alt rotation: ${altSeasonScore > 0.1 ? 'risk-on' : altSeasonScore < -0.1 ? 'risk-off' : 'neutral'}.`,
    dataFreshness: 'current',
    agentVersion: AGENT_VERSION,
  };
}

export async function run(date: Date): Promise<AgentScore[]> {
  const supabase = createSupabaseClient();
  const dateStr = date.toISOString().split('T')[0]!;

  const [stockRegime, cryptoRegime] = await Promise.all([
    runStockRegime(supabase, dateStr),
    runCryptoRegime(supabase, dateStr),
  ]);

  await Promise.all([
    writeToDB(supabase, stockRegime),
    writeToDB(supabase, cryptoRegime),
  ]);

  return [stockRegime, cryptoRegime];
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
    console.error(`[Regime] Upsert error for ${agentScore.ticker}:`, error.message);
  }
}
