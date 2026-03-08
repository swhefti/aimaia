import type { AgentScore } from '../../shared/types/scores.js';
import type { PriceHistory } from '../../shared/types/assets.js';
import { createSupabaseClient } from '../../shared/lib/supabase.js';

const AGENT_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Pure calculation functions (no DB I/O)
// ---------------------------------------------------------------------------

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

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 0;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i]! - closes[i - 1]!;
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function scoreRSI(rsi: number): number {
  if (rsi < 30) return 0.7;
  if (rsi > 70) return -0.5;
  // Proportional mapping: 30-50 → positive, 50-70 → negative
  return ((50 - rsi) / 50) * 0.5;
}

function calculateMACD(closes: number[]): { macdLine: number; signalLine: number; histogram: number } {
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);

  const macdLineArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLineArr.push(ema12[i]! - ema26[i]!);
  }

  const signalLineArr = calculateEMA(macdLineArr, 9);
  const lastIdx = closes.length - 1;
  const macdLine = macdLineArr[lastIdx]!;
  const signalLine = signalLineArr[lastIdx]!;

  return { macdLine, signalLine, histogram: macdLine - signalLine };
}

function scoreMACD(macd: { macdLine: number; signalLine: number; histogram: number }): number {
  let score = 0;
  // Bullish crossover: MACD above signal
  if (macd.macdLine > macd.signalLine) score += 0.5;
  else score -= 0.5;
  // Histogram direction adds nuance
  if (macd.histogram > 0) score += 0.1;
  else score -= 0.1;
  return clamp(score, -1, 1);
}

function calculateEMAs(closes: number[]): { ema20: number; ema50: number; ema200: number } {
  const ema20Arr = calculateEMA(closes, 20);
  const ema50Arr = calculateEMA(closes, 50);
  const ema200Arr = calculateEMA(closes, 200);
  return {
    ema20: ema20Arr[ema20Arr.length - 1]!,
    ema50: ema50Arr[ema50Arr.length - 1]!,
    ema200: ema200Arr[ema200Arr.length - 1]!,
  };
}

function scoreEMAs(price: number, emas: { ema20: number; ema50: number; ema200: number }): number {
  let score = 0;
  if (price > emas.ema20) score += 0.3;
  else score -= 0.3;
  if (emas.ema20 > emas.ema50) score += 0.3;
  else score -= 0.3;
  if (emas.ema50 > emas.ema200) score += 0.3;
  else score -= 0.3;
  return clamp(score, -1, 1);
}

function calculateBollinger(closes: number[], period = 20, stdDevMult = 2): { upper: number; middle: number; lower: number; position: number } {
  const slice = closes.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  const upper = mean + stdDevMult * stdDev;
  const lower = mean - stdDevMult * stdDev;
  const currentPrice = closes[closes.length - 1]!;
  const position = stdDev === 0 ? 0.5 : (currentPrice - lower) / (upper - lower);

  return { upper, middle: mean, lower, position };
}

function scoreBollinger(position: number): number {
  // position 0 = at lower band → bullish, 1 = at upper band → bearish
  if (position <= 0.1) return 0.3;
  if (position >= 0.9) return -0.3;
  return (0.5 - position) * 0.6;
}

function calculateVolumeSignal(closes: number[], volumes: number[]): number {
  if (volumes.length < 21) return 0;
  const avgVol = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
  const currentVol = volumes[volumes.length - 1]!;
  const volRatio = avgVol === 0 ? 1 : currentVol / avgVol;
  const priceChange = closes[closes.length - 1]! - closes[closes.length - 2]!;

  if (volRatio > 1.2 && priceChange > 0) return 0.2;
  if (volRatio > 1.2 && priceChange < 0) return -0.2;
  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

function computeTechnicalScore(closes: number[], volumes: number[]): {
  score: number;
  confidence: number;
  components: Record<string, number>;
  raw: Record<string, number>;
} {
  const hasEnoughData = closes.length >= 200;
  const currentPrice = closes[closes.length - 1]!;

  const rsi = calculateRSI(closes);
  const rsiScore = scoreRSI(rsi);

  const macd = calculateMACD(closes);
  const macdScore = scoreMACD(macd);

  const emas = calculateEMAs(closes);
  const emaScore = scoreEMAs(currentPrice, emas);

  const bollinger = calculateBollinger(closes);
  const bollingerScore = scoreBollinger(bollinger.position);

  const volumeScore = calculateVolumeSignal(closes, volumes);

  const technicalScore = clamp(
    macdScore * 0.30 +
    emaScore * 0.25 +
    rsiScore * 0.20 +
    bollingerScore * 0.15 +
    volumeScore * 0.10,
    -1,
    1
  );

  // Confidence
  let confidence = hasEnoughData ? 0.7 : 0.5;
  const signs = [macdScore, emaScore, rsiScore, bollingerScore, volumeScore].map(Math.sign);
  const agreeing = signs.filter((s) => s === Math.sign(technicalScore)).length;
  if (agreeing >= 4) confidence += 0.2;
  confidence = clamp(confidence, 0, 1);

  return {
    score: technicalScore,
    confidence,
    components: {
      rsiScore,
      macdScore,
      emaScore,
      bollingerScore,
      volumeScore,
    },
    raw: {
      rsi,
      macdLine: macd.macdLine,
      macdSignal: macd.signalLine,
      macdHistogram: macd.histogram,
      ema20: emas.ema20,
      ema50: emas.ema50,
      ema200: emas.ema200,
      bollingerPosition: bollinger.position,
    },
  };
}

// ---------------------------------------------------------------------------
// DB I/O wrapper (ScoringAgent interface)
// ---------------------------------------------------------------------------

export async function run(ticker: string, date: Date): Promise<AgentScore> {
  const supabase = createSupabaseClient();
  const dateStr = date.toISOString().split('T')[0]!;

  const { data: priceData, error } = await supabase
    .from('price_history')
    .select('close, volume')
    .eq('ticker', ticker)
    .lte('date', dateStr)
    .order('date', { ascending: true })
    .limit(250);

  if (error) {
    console.error(`[Technical] DB error for ${ticker}:`, error.message);
    throw new Error(`Failed to fetch price_history for ${ticker}: ${error.message}`);
  }

  const rows = priceData ?? [];
  if (rows.length < 2) {
    return {
      ticker,
      date: dateStr,
      agentType: 'technical',
      score: 0,
      confidence: 0.1,
      componentScores: {},
      explanation: 'Insufficient price history for technical analysis.',
      dataFreshness: 'missing',
      agentVersion: AGENT_VERSION,
    };
  }

  const closes = rows.map((r) => Number(r.close));
  const volumes = rows.map((r) => Number(r.volume));
  const freshness = rows.length >= 200 ? 'current' : 'stale';

  const { score, confidence, components, raw } = computeTechnicalScore(closes, volumes);

  const agentScore: AgentScore = {
    ticker,
    date: dateStr,
    agentType: 'technical',
    score,
    confidence,
    componentScores: components,
    explanation: `Technical score ${score.toFixed(2)} (RSI=${raw['rsi']?.toFixed(1)}, MACD hist=${raw['macdHistogram']?.toFixed(4)}, EMA alignment=${components['emaScore']?.toFixed(2)})`,
    dataFreshness: freshness,
    agentVersion: AGENT_VERSION,
  };

  const { error: upsertError } = await supabase.from('agent_scores').upsert(
    {
      ticker,
      date: dateStr,
      agent_type: 'technical',
      score,
      confidence,
      component_scores: components,
      explanation: agentScore.explanation,
      data_freshness: freshness,
      agent_version: AGENT_VERSION,
    },
    { onConflict: 'ticker,date,agent_type' }
  );

  if (upsertError) {
    console.error(`[Technical] Upsert error for ${ticker}:`, upsertError.message);
  }

  return agentScore;
}

export async function runBatch(tickers: string[], date: Date): Promise<AgentScore[]> {
  const results: AgentScore[] = [];
  for (const ticker of tickers) {
    try {
      const result = await run(ticker, date);
      results.push(result);
    } catch (err) {
      console.error(`[Technical] Failed for ${ticker}:`, err);
    }
  }
  return results;
}
