import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { ASSET_UNIVERSE, ASSET_TYPE_MAP, CRYPTO } from '@shared/lib/constants';
import { getConfig, getConfigNumber, getConfigBatch, getConfigNumberBatch } from '@/lib/config';

/**
 * GET /api/cron/scores
 * Vercel Cron: runs daily at 22:00 UTC (after prices are in).
 * Runs technical + sentiment + fundamental + market_regime scoring for all tickers,
 * then generates conclusions.
 */

const CRYPTO_SET = new Set(CRYPTO);

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

type SB = ReturnType<typeof getServiceSupabase>;

interface CronConfig {
  sentimentModel: string;
  sentimentFilterModel: string;
  conclusionModel: string;
  promptSentiment: string;
  promptSentimentFilter: string;
  promptConclusion: string;
  sentimentLookbackDays: number;
  cryptoMinQualifying: number;
  sentimentDecayFactor: number;
  maxTokensSentiment: number;
  maxTokensConclusion: number;
  maxCharsConclusion: number;
  subweightMacd: number;
  subweightEma: number;
  subweightRsi: number;
  subweightBollinger: number;
  subweightVolume: number;
}

// ---- Score upsert helper ----

async function upsertScore(
  supabase: SB, ticker: string, date: string, agentType: string,
  score: number, confidence: number,
  components: Record<string, number>, explanation: string, freshness: string,
) {
  await supabase.from('agent_scores').upsert(
    { ticker, date, agent_type: agentType, score, confidence, component_scores: components, explanation, data_freshness: freshness, agent_version: 'cron-1.0' },
    { onConflict: 'ticker,date,agent_type' },
  );
}

// ---- Technical scoring ----

function calculateEMA(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [closes[0]!];
  for (let i = 1; i < closes.length; i++) {
    ema.push(closes[i]! * k + ema[i - 1]! * (1 - k));
  }
  return ema;
}

function calculateRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch > 0) avgGain += ch; else avgLoss += Math.abs(ch);
  }
  avgGain /= period; avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch > 0) { avgGain = (avgGain * (period - 1) + ch) / period; avgLoss = (avgLoss * (period - 1)) / period; }
    else { avgGain = (avgGain * (period - 1)) / period; avgLoss = (avgLoss * (period - 1) + Math.abs(ch)) / period; }
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

async function runTechnical(supabase: SB, ticker: string, dateStr: string, cfg: CronConfig): Promise<string> {
  const { data: priceData } = await supabase
    .from('price_history').select('close, volume').eq('ticker', ticker)
    .lte('date', dateStr).order('date', { ascending: true }).limit(250);

  const rows = priceData ?? [];
  if (rows.length < 2) {
    await upsertScore(supabase, ticker, dateStr, 'technical', 0, 0.1, {}, 'Insufficient data', 'missing');
    return 'insufficient data';
  }

  const closes = rows.map((r) => Number(r.close));
  const volumes = rows.map((r) => Number(r.volume));

  const rsi = calculateRSI(closes);
  const rsiScore = rsi < 30 ? 0.7 : rsi > 70 ? -0.5 : ((50 - rsi) / 50) * 0.5;

  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]!);
  const signalLine = calculateEMA(macdLine, 9);
  const li = closes.length - 1;
  const macdVal = macdLine[li]!;
  const sigVal = signalLine[li]!;
  const hist = macdVal - sigVal;
  let macdScore = macdVal > sigVal ? 0.5 : -0.5;
  macdScore += hist > 0 ? 0.1 : -0.1;
  macdScore = clamp(macdScore, -1, 1);

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const price = closes[li]!;
  let emaScore = 0;
  if (price > ema20[li]!) emaScore += 0.3; else emaScore -= 0.3;
  if (ema20[li]! > ema50[li]!) emaScore += 0.3; else emaScore -= 0.3;
  if (ema50[li]! > ema200[li]!) emaScore += 0.3; else emaScore -= 0.3;
  emaScore = clamp(emaScore, -1, 1);

  const slice20 = closes.slice(-20);
  const mean = slice20.reduce((s, v) => s + v, 0) / slice20.length;
  const stdDev = Math.sqrt(slice20.reduce((s, v) => s + (v - mean) ** 2, 0) / slice20.length);
  const upper = mean + 2 * stdDev;
  const lower = mean - 2 * stdDev;
  const bollPos = stdDev === 0 ? 0.5 : (price - lower) / (upper - lower);
  const bollScore = bollPos <= 0.1 ? 0.3 : bollPos >= 0.9 ? -0.3 : (0.5 - bollPos) * 0.6;

  let volScore = 0;
  if (volumes.length >= 21) {
    const avgVol = volumes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20;
    const curVol = volumes[li]!;
    const ratio = avgVol === 0 ? 1 : curVol / avgVol;
    const priceChg = closes[li]! - closes[li - 1]!;
    if (ratio > 1.2 && priceChg > 0) volScore = 0.2;
    else if (ratio > 1.2 && priceChg < 0) volScore = -0.2;
  }

  const score = clamp(macdScore * cfg.subweightMacd + emaScore * cfg.subweightEma + rsiScore * cfg.subweightRsi + bollScore * cfg.subweightBollinger + volScore * cfg.subweightVolume, -1, 1);
  const signs = [macdScore, emaScore, rsiScore, bollScore, volScore].map(Math.sign);
  const agreeing = signs.filter((s) => s === Math.sign(score)).length;
  let confidence = rows.length >= 200 ? 0.7 : 0.5;
  if (agreeing >= 4) confidence += 0.2;
  confidence = clamp(confidence, 0, 1);

  const components = { rsiScore, macdScore, emaScore, bollingerScore: bollScore, volumeScore: volScore };
  const explanation = `Technical ${score.toFixed(2)} (RSI=${rsi.toFixed(1)}, MACD hist=${hist.toFixed(4)}, EMA=${emaScore.toFixed(2)})`;
  await upsertScore(supabase, ticker, dateStr, 'technical', score, confidence, components, explanation, rows.length >= 200 ? 'current' : 'stale');
  return `ok (score=${score.toFixed(2)})`;
}

// ---- Sentiment scoring ----

async function runSentiment(supabase: SB, ticker: string, dateStr: string, anthropic: Anthropic, cfg: CronConfig): Promise<string> {
  const lookbackDate = new Date(dateStr);
  lookbackDate.setDate(lookbackDate.getDate() - cfg.sentimentLookbackDays);
  const tenDaysAgoStr = lookbackDate.toISOString().split('T')[0]!;
  const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';

  const { data: newsData } = await supabase
    .from('news_data').select('headline, summary, source, published_at')
    .eq('ticker', ticker).gte('published_at', tenDaysAgoStr).lte('published_at', dateStr + 'T23:59:59Z')
    .order('published_at', { ascending: false }).limit(20);

  let newsItems = (newsData ?? []) as { headline: string; summary: string | null; source: string; published_at: string }[];
  const totalFetched = newsItems.length;

  // Crypto relevance filter
  if (isCrypto && newsItems.length > 0) {
    try {
      const articleList = newsItems.map((n, i) => `${i + 1}. ${n.headline}${n.summary ? ` — ${n.summary}` : ''}`).join('\n');
      const filterResp = await anthropic.messages.create({
        model: cfg.sentimentFilterModel, max_tokens: cfg.maxTokensSentiment,
        system: cfg.promptSentimentFilter,
        messages: [{ role: 'user', content: `Asset: ${ticker}\n\nArticles:\n${articleList}\n\nReturn: {"results": [true/false, ...]}` }],
      });
      const rawText = filterResp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim()) as { results: boolean[] };
      newsItems = newsItems.filter((_, i) => parsed.results[i] === true);
    } catch { /* keep all on failure */ }
  }

  const insufficientNews = newsItems.length === 0 || (isCrypto && newsItems.length < cfg.cryptoMinQualifying);

  if (insufficientNews) {
    if (isCrypto) {
      await upsertScore(supabase, ticker, dateStr, 'sentiment', 0, 0, { newsCount: totalFetched, qualifyingCount: newsItems.length }, 'Insufficient qualifying articles', 'missing');
      return `missing (${newsItems.length}/${cfg.cryptoMinQualifying} articles)`;
    }
    const yesterday = new Date(dateStr);
    yesterday.setDate(yesterday.getDate() - 1);
    const { data: prev } = await supabase.from('agent_scores').select('score').eq('ticker', ticker).eq('agent_type', 'sentiment').eq('date', yesterday.toISOString().split('T')[0]!).single();
    const decayed = prev ? clamp(Number(prev.score) * cfg.sentimentDecayFactor, -1, 1) : 0;
    await upsertScore(supabase, ticker, dateStr, 'sentiment', decayed, 0.1, { newsCount: 0, decayApplied: prev ? 1 : 0 }, 'No news, decayed previous', 'missing');
    return `decayed (score=${decayed.toFixed(2)})`;
  }

  const newsList = newsItems.map((n, i) => `${i + 1}. [${n.published_at}] (${n.source}) ${n.headline}${n.summary ? ` — ${n.summary}` : ''}`).join('\n');
  const resp = await anthropic.messages.create({
    model: cfg.sentimentModel, max_tokens: cfg.maxTokensSentiment,
    system: cfg.promptSentiment.replace(/\{\{ticker\}\}/g, ticker),
    messages: [{ role: 'user', content: `Articles:\n${newsList}\n\nReturn: {"sentiment_score": float, "confidence": float, "key_themes": string[], "reasoning": string}` }],
  });

  const rawText = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
  const parsed = JSON.parse(rawText.replace(/```json|```/g, '').trim()) as { sentiment_score: number; confidence: number; key_themes: string[]; reasoning: string };

  const score = clamp(parsed.sentiment_score, -1, 1);
  const todayNews = newsItems.filter((n) => n.published_at.startsWith(dateStr));
  let conf = clamp(parsed.confidence, 0, 1);
  if (newsItems.length >= 5) conf = Math.min(conf + 0.1, 1);
  if (todayNews.length > 0) conf = Math.min(conf + 0.1, 1);

  const explanation = `${parsed.reasoning} Key themes: ${parsed.key_themes.join(', ')}`;
  await upsertScore(supabase, ticker, dateStr, 'sentiment', score, conf, { rawScore: score, newsCount: totalFetched, qualifyingCount: newsItems.length, todayNewsCount: todayNews.length }, explanation, todayNews.length > 0 ? 'current' : 'stale');
  return `ok (score=${score.toFixed(2)})`;
}

// ---- Fundamental scoring ----

const SECTOR_MEDIAN_PE: Record<string, number> = {
  technology: 28, healthcare: 22, financials: 14, 'consumer cyclical': 20,
  'consumer defensive': 24, industrials: 18, energy: 12, 'real estate': 30,
  utilities: 18, 'communication services': 20, 'basic materials': 15, default: 20,
};

async function runFundamental(supabase: SB, ticker: string, dateStr: string): Promise<string> {
  const assetType = ASSET_TYPE_MAP[ticker];
  if (assetType === 'crypto') {
    await upsertScore(supabase, ticker, dateStr, 'fundamental', 0, 0.1, {}, 'Not applicable to crypto', 'missing');
    return 'n/a (crypto)';
  }
  if (assetType === 'etf') {
    await upsertScore(supabase, ticker, dateStr, 'fundamental', 0, 0.3, { etfDefault: 0 }, 'ETF baseline', 'current');
    return 'baseline (etf)';
  }

  const { data: fundData } = await supabase
    .from('fundamental_data').select('pe_ratio, revenue_growth_yoy, profit_margin, roe, debt_to_equity, date')
    .eq('ticker', ticker).lte('date', dateStr).order('date', { ascending: false }).limit(1).single();

  if (!fundData) {
    await upsertScore(supabase, ticker, dateStr, 'fundamental', 0, 0.1, {}, 'No fundamental data', 'missing');
    return 'missing';
  }

  const pe = fundData.pe_ratio as number | null;
  const rev = fundData.revenue_growth_yoy as number | null;
  const margin = fundData.profit_margin as number | null;
  const roe = fundData.roe as number | null;
  const debt = fundData.debt_to_equity as number | null;

  const { data: assetInfo } = await supabase.from('assets').select('sector').eq('ticker', ticker).single();
  const sector = (assetInfo?.sector as string) ?? 'default';
  const medianPE = SECTOR_MEDIAN_PE[sector.toLowerCase()] ?? 20;

  const peScore = pe === null ? 0 : pe < 0 ? -0.4 : (() => { const r = pe / medianPE; return r < 0.5 ? 0.5 : r < 0.8 ? 0.3 : r < 1.2 ? 0 : r < 1.5 ? -0.2 : -0.4; })();
  const revScore = rev === null ? 0 : rev > 0.2 ? 0.5 : rev > 0.1 ? 0.3 : rev > 0 ? 0.1 : -0.4;
  const marginScore = margin === null ? 0 : margin > 0.2 ? 0.3 : margin > 0.05 ? 0.1 : margin >= 0 ? 0 : -0.3;
  const roeScore = roe === null ? 0 : roe > 0.2 ? 0.3 : roe > 0.1 ? 0.1 : roe >= 0 ? 0 : -0.4;
  const debtScore = debt === null ? 0 : debt > 3 ? -0.3 : debt > 1 ? -0.1 : 0.1;

  const score = clamp(peScore * 0.25 + revScore * 0.25 + marginScore * 0.15 + roeScore * 0.2 + debtScore * 0.15, -1, 1);
  const available = [pe, rev, margin, roe, debt].filter((v) => v !== null).length;
  const daysDiff = Math.floor((new Date(dateStr).getTime() - new Date(fundData.date as string).getTime()) / 86400000);
  const freshness = daysDiff > 90 ? 'stale' : 'current';
  const confidence = freshness === 'stale' ? Math.min(clamp(0.3 + (available / 5) * 0.5, 0, 1), 0.3) : clamp(0.3 + (available / 5) * 0.5, 0, 1);

  await upsertScore(supabase, ticker, dateStr, 'fundamental', score, confidence, { peScore, revenueScore: revScore, marginScore, roeScore, debtScore }, `Fundamental ${score.toFixed(2)}`, freshness);
  return `ok (score=${score.toFixed(2)})`;
}

// ---- Market Regime scoring ----

function calculateRealizedVol(closes: number[], window: number, annualizationFactor: number): number {
  if (closes.length < window + 1) return 0;
  const returns: number[] = [];
  const slice = closes.slice(-(window + 1));
  for (let i = 1; i < slice.length; i++) returns.push(Math.log(slice[i]! / slice[i - 1]!));
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance) * Math.sqrt(annualizationFactor);
}

function scoreTrend(price: number, shortEma: number, longEma: number): number {
  let score = 0;
  if (price > shortEma) score += 0.4; else score -= 0.4;
  if (shortEma > longEma) score += 0.4; else score -= 0.4;
  score += clamp(((price - shortEma) / shortEma) * 2, -0.2, 0.2);
  return clamp(score, -1, 1);
}

/** Compute trend score adaptively based on available data length */
function computeAdaptiveTrend(closes: number[]): { trendScore: number; confidence: number } {
  const price = closes[closes.length - 1]!;
  const li = closes.length - 1;
  if (closes.length >= 200) {
    const ema50 = calculateEMA(closes, 50);
    const ema200 = calculateEMA(closes, 200);
    return { trendScore: scoreTrend(price, ema50[li]!, ema200[li]!), confidence: 0.8 };
  }
  if (closes.length >= 50) {
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    return { trendScore: scoreTrend(price, ema20[li]!, ema50[li]!), confidence: 0.6 };
  }
  // >= 20
  const ema10 = calculateEMA(closes, 10);
  const ema20 = calculateEMA(closes, 20);
  return { trendScore: scoreTrend(price, ema10[li]!, ema20[li]!), confidence: 0.4 };
}

function scoreVolatility(vol: number, thresholds: { low: number; normal: number; elevated: number }): number {
  if (vol < thresholds.low) return 0.5;
  if (vol < thresholds.normal) return 0.3;
  if (vol < thresholds.elevated) return 0.0;
  if (vol < thresholds.elevated * 1.5) return -0.3;
  return -0.6;
}

function getRegimeLabel(score: number): string {
  if (score > 0.4) return 'bullish';
  if (score > 0.1) return 'neutral';
  if (score > -0.3) return 'cautious';
  return 'bearish';
}

async function fetchCloses(supabase: SB, ticker: string, dateStr: string): Promise<number[]> {
  const { data } = await supabase.from('price_history').select('close').eq('ticker', ticker).lte('date', dateStr).order('date', { ascending: true }).limit(250);
  return (data ?? []).map((r) => Number(r.close));
}

async function runRegime(supabase: SB, dateStr: string): Promise<{ stock: string; crypto: string }> {
  // Stock regime
  const [spyCloses, xlkCloses, xlvCloses] = await Promise.all([
    fetchCloses(supabase, 'SPY', dateStr),
    fetchCloses(supabase, 'XLK', dateStr),
    fetchCloses(supabase, 'XLV', dateStr),
  ]);

  if (spyCloses.length >= 20) {
    const { trendScore: spyTrendScore, confidence: trendConfidence } = computeAdaptiveTrend(spyCloses);
    const vol = calculateRealizedVol(spyCloses, Math.min(20, spyCloses.length - 1), 252);
    const volScore = scoreVolatility(vol, { low: 0.10, normal: 0.15, elevated: 0.20 });

    let sectorScore = 0;
    if (xlkCloses.length >= 21 && xlvCloses.length >= 21) {
      const xlkRet = (xlkCloses[xlkCloses.length - 1]! - xlkCloses[xlkCloses.length - 21]!) / xlkCloses[xlkCloses.length - 21]!;
      const xlvRet = (xlvCloses[xlvCloses.length - 1]! - xlvCloses[xlvCloses.length - 21]!) / xlvCloses[xlvCloses.length - 21]!;
      const diff = xlkRet - xlvRet;
      sectorScore = diff > 0.02 ? 0.3 : diff < -0.02 ? -0.3 : 0;
    }

    const regimeScore = clamp(spyTrendScore * 0.50 + volScore * 0.30 + sectorScore * 0.20, -1, 1);
    const label = getRegimeLabel(regimeScore);
    const components = {
      spyTrendScore,
      volatilityScore: volScore,
      sectorRotationScore: sectorScore,
      regimeLabel: label,
      volatilityLevel: vol < 0.10 ? 'low' : vol < 0.20 ? 'moderate' : 'high',
      broadTrend: spyTrendScore > 0.2 ? 'uptrend' : spyTrendScore < -0.2 ? 'downtrend' : 'sideways',
      sectorRotation: sectorScore > 0.1 ? 'risk-on' : sectorScore < -0.1 ? 'risk-off' : 'balanced',
    };
    await upsertScore(supabase, 'MARKET', dateStr, 'market_regime', regimeScore, trendConfidence, components as unknown as Record<string, number>, `Stock regime: ${label} (${regimeScore.toFixed(2)})`, 'current');
  } else {
    await upsertScore(supabase, 'MARKET', dateStr, 'market_regime', 0, 0.1, {}, 'Insufficient SPY data', 'missing');
  }

  // Crypto regime
  const [btcCloses, ethCloses] = await Promise.all([
    fetchCloses(supabase, 'BTC', dateStr),
    fetchCloses(supabase, 'ETH', dateStr),
  ]);

  if (btcCloses.length >= 20) {
    const { trendScore: btcTrendScore, confidence: trendConfidence } = computeAdaptiveTrend(btcCloses);
    const vol = calculateRealizedVol(btcCloses, Math.min(20, btcCloses.length - 1), 365);
    const volScore = scoreVolatility(vol, { low: 0.40, normal: 0.60, elevated: 0.80 });

    let altScore = 0;
    if (ethCloses.length >= 21 && btcCloses.length >= 21) {
      const ethRet = (ethCloses[ethCloses.length - 1]! - ethCloses[ethCloses.length - 21]!) / ethCloses[ethCloses.length - 21]!;
      const btcRet = (btcCloses[btcCloses.length - 1]! - btcCloses[btcCloses.length - 21]!) / btcCloses[btcCloses.length - 21]!;
      altScore = clamp((ethRet - btcRet) * 3, -0.3, 0.3);
    }

    const regimeScore = clamp(btcTrendScore * 0.50 + volScore * 0.25 + altScore * 0.25, -1, 1);
    const label = getRegimeLabel(regimeScore);
    const components = {
      btcTrendScore,
      volatilityScore: volScore,
      altSeasonScore: altScore,
      regimeLabel: label,
      volatilityLevel: vol < 0.40 ? 'low' : vol < 0.80 ? 'moderate' : 'high',
      broadTrend: btcTrendScore > 0.2 ? 'uptrend' : btcTrendScore < -0.2 ? 'downtrend' : 'sideways',
      sectorRotation: altScore > 0.1 ? 'risk-on' : altScore < -0.1 ? 'risk-off' : 'balanced',
    };
    await upsertScore(supabase, 'MARKET_CRYPTO', dateStr, 'market_regime', regimeScore, trendConfidence, components as unknown as Record<string, number>, `Crypto regime: ${label} (${regimeScore.toFixed(2)})`, 'current');
  } else {
    await upsertScore(supabase, 'MARKET_CRYPTO', dateStr, 'market_regime', 0, 0.1, {}, 'Insufficient BTC data', 'missing');
  }

  return { stock: 'ok', crypto: 'ok' };
}

// ---- Conclusion generation ----

async function generateConclusions(supabase: SB, anthropic: Anthropic, dateStr: string, cfg: CronConfig): Promise<{ generated: number; errors: number }> {
  const tickers = [...ASSET_UNIVERSE];

  // Skip tickers that already have today's conclusion
  const { data: existing } = await supabase.from('ticker_conclusions').select('ticker').eq('date', dateStr).in('ticker', tickers);
  const done = new Set((existing ?? []).map((r) => r.ticker as string));
  const todo = tickers.filter((t) => !done.has(t));
  if (todo.length === 0) return { generated: 0, errors: 0 };

  // Batch-fetch data
  const [allScores, allNews, allAssets, allFunds, allQuotes] = await Promise.all([
    fetchAllScores(supabase, dateStr),
    fetchAllNews(supabase, todo),
    fetchAllAssets(supabase),
    fetchAllFundamentals(supabase),
    fetchAllQuotes(supabase),
  ]);

  let generated = 0, errors = 0;

  for (let i = 0; i < todo.length; i += 5) {
    const batch = todo.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map(async (ticker) => {
        const asset = allAssets[ticker];
        const name = asset?.name ?? ticker;
        const type = asset?.asset_type ?? 'stock';
        const scores = allScores[ticker] ?? {};
        const news = allNews[ticker] ?? [];
        const fund = allFunds[ticker];
        const quote = allQuotes[ticker];

        const scoreParts = Object.entries(scores).map(([k, v]) => `${k}: ${v.score.toFixed(2)} (conf ${v.confidence.toFixed(2)})`);
        const newsParts = news.slice(0, 3).map((n) => `"${n.headline}" — ${n.source}`);
        const fundParts: string[] = [];
        if (fund) {
          if (fund.pe_ratio != null) fundParts.push(`P/E ${fund.pe_ratio.toFixed(1)}`);
          if (fund.revenue_growth_yoy != null) fundParts.push(`rev growth ${(fund.revenue_growth_yoy * 100).toFixed(1)}%`);
          if (fund.profit_margin != null) fundParts.push(`margin ${(fund.profit_margin * 100).toFixed(1)}%`);
          if (fund.market_cap != null) fundParts.push(`mkt cap $${(fund.market_cap / 1e9).toFixed(1)}B`);
        }
        const priceLine = quote ? `Price $${quote.last_price.toFixed(2)}, change ${(quote.pct_change * 100).toFixed(2)}%` : '';

        const system = cfg.promptConclusion
          ? cfg.promptConclusion
              .replace(/\{\{name\}\}/g, name)
              .replace(/\{\{ticker\}\}/g, ticker)
              .replace(/\{\{type\}\}/g, type)
              .replace(/\{\{max_chars\}\}/g, String(cfg.maxCharsConclusion))
          : `Write a single paragraph (3-5 sentences, max ${cfg.maxCharsConclusion} characters) analyzing ${name} (${ticker}), a ${type}.\nSentence 1: Brief intro, current price.\nSentences 2-3: What agent scores collectively signal.\nSentence 4-5: News situation.\nRules: single paragraph, no bullets, max ${cfg.maxCharsConclusion} chars. Be specific. Never give advice. Output ONLY the paragraph.`;
        const user = [priceLine, `Scores: ${scoreParts.join('; ') || 'none'}`, fundParts.length ? `Fundamentals: ${fundParts.join(', ')}` : '', `News: ${newsParts.join('; ') || 'no recent news'}`].filter(Boolean).join('\n');

        const resp = await anthropic.messages.create({ model: cfg.conclusionModel, max_tokens: cfg.maxTokensConclusion, system, messages: [{ role: 'user', content: user }] });
        let text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
        if (text.length > cfg.maxCharsConclusion) {
          const cut = text.slice(0, cfg.maxCharsConclusion);
          const lastDot = cut.lastIndexOf('.');
          text = lastDot > cfg.maxCharsConclusion * 0.5 ? cut.slice(0, lastDot + 1) : cut.trimEnd() + '...';
        }

        const { error } = await supabase.from('ticker_conclusions').upsert({ ticker, date: dateStr, conclusion: text }, { onConflict: 'ticker,date' });
        if (error) throw new Error(error.message);
        return ticker;
      }),
    );

    for (const r of results) {
      if (r.status === 'fulfilled') generated++;
      else { errors++; console.error('[Cron/Scores] Conclusion error:', r.reason); }
    }

    if (i + 5 < todo.length) await new Promise((r) => setTimeout(r, 500));
  }

  return { generated, errors };
}

// ---- Data fetching helpers for conclusions ----

async function fetchAllScores(supabase: SB, dateStr: string) {
  const { data } = await supabase.from('agent_scores').select('ticker, agent_type, score, confidence').eq('date', dateStr).limit(2000);
  const r: Record<string, Record<string, { score: number; confidence: number }>> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = {};
    r[t][row.agent_type as string] = { score: Number(row.score), confidence: Number(row.confidence) };
  }
  return r;
}

async function fetchAllNews(supabase: SB, tickers: string[]) {
  if (!tickers.length) return {};
  const { data } = await supabase.from('news_data').select('ticker, headline, source').in('ticker', tickers).order('published_at', { ascending: false }).limit(tickers.length * 3);
  const r: Record<string, { headline: string; source: string }[]> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = [];
    if (r[t].length < 3) r[t].push({ headline: row.headline as string, source: row.source as string });
  }
  return r;
}

async function fetchAllAssets(supabase: SB) {
  const { data } = await supabase.from('assets').select('ticker, name, asset_type');
  const r: Record<string, { name: string; asset_type: string }> = {};
  for (const row of data ?? []) r[row.ticker as string] = { name: row.name as string, asset_type: row.asset_type as string };
  return r;
}

async function fetchAllFundamentals(supabase: SB) {
  const { data } = await supabase.from('fundamental_data').select('ticker, pe_ratio, revenue_growth_yoy, profit_margin, market_cap').order('date', { ascending: false }).limit(2000);
  const r: Record<string, { pe_ratio: number | null; revenue_growth_yoy: number | null; profit_margin: number | null; market_cap: number | null }> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = { pe_ratio: row.pe_ratio != null ? Number(row.pe_ratio) : null, revenue_growth_yoy: row.revenue_growth_yoy != null ? Number(row.revenue_growth_yoy) : null, profit_margin: row.profit_margin != null ? Number(row.profit_margin) : null, market_cap: row.market_cap != null ? Number(row.market_cap) : null };
  }
  return r;
}

async function fetchAllQuotes(supabase: SB) {
  const { data } = await supabase.from('market_quotes').select('ticker, last_price, pct_change').order('date', { ascending: false }).limit(2000);
  const r: Record<string, { last_price: number; pct_change: number }> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = { last_price: Number(row.last_price), pct_change: Number(row.pct_change) };
  }
  return r;
}

// ---- Main handler ----

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env['CRON_SECRET']}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });

  const startedAt = new Date().toISOString();
  const dateStr = new Date().toISOString().split('T')[0]!;
  console.log(`[Cron/Scores] Starting for ${dateStr} at ${startedAt}`);

  const supabase = getServiceSupabase();
  const anthropic = new Anthropic({ apiKey });
  const tickers = [...ASSET_UNIVERSE];

  // Load runtime config
  const [cfgStrings, cfgNumbers] = await Promise.all([
    getConfigBatch({
      model_sentiment: 'claude-haiku-4-5-20251001',
      model_sentiment_filter: 'claude-haiku-4-5-20251001',
      model_conclusion: 'claude-sonnet-4-6',
      prompt_sentiment: 'You are a financial sentiment analyst. Analyze news for {{ticker}}. Return ONLY valid JSON.',
      prompt_sentiment_filter: 'You classify whether a crypto asset is the PRIMARY subject of news articles. Return ONLY valid JSON.',
      prompt_conclusion: '',
    }),
    getConfigNumberBatch({
      sentiment_lookback_days: 10,
      sentiment_min_articles_crypto: 3,
      sentiment_decay_factor: 0.9,
      max_tokens_sentiment: 300,
      max_tokens_conclusion: 300,
      max_chars_conclusion: 450,
      subweight_technical_macd: 0.30,
      subweight_technical_ema: 0.25,
      subweight_technical_rsi: 0.20,
      subweight_technical_bollinger: 0.15,
      subweight_technical_volume: 0.10,
    }),
  ]);

  const cronCfg: CronConfig = {
    sentimentModel: cfgStrings['model_sentiment']!,
    sentimentFilterModel: cfgStrings['model_sentiment_filter']!,
    conclusionModel: cfgStrings['model_conclusion']!,
    promptSentiment: cfgStrings['prompt_sentiment']!,
    promptSentimentFilter: cfgStrings['prompt_sentiment_filter']!,
    promptConclusion: cfgStrings['prompt_conclusion']!,
    sentimentLookbackDays: cfgNumbers['sentiment_lookback_days']!,
    cryptoMinQualifying: cfgNumbers['sentiment_min_articles_crypto']!,
    sentimentDecayFactor: cfgNumbers['sentiment_decay_factor']!,
    maxTokensSentiment: cfgNumbers['max_tokens_sentiment']!,
    maxTokensConclusion: cfgNumbers['max_tokens_conclusion']!,
    maxCharsConclusion: cfgNumbers['max_chars_conclusion']!,
    subweightMacd: cfgNumbers['subweight_technical_macd']!,
    subweightEma: cfgNumbers['subweight_technical_ema']!,
    subweightRsi: cfgNumbers['subweight_technical_rsi']!,
    subweightBollinger: cfgNumbers['subweight_technical_bollinger']!,
    subweightVolume: cfgNumbers['subweight_technical_volume']!,
  };

  const scoreResults: Record<string, { technical: string; sentiment: string; fundamental: string }> = {};
  let totalSuccess = 0;
  let totalErrors = 0;

  // Process tickers in batches of 5 (sentiment uses LLM)
  for (let i = 0; i < tickers.length; i += 5) {
    const batch = tickers.slice(i, i + 5);
    await Promise.allSettled(
      batch.map(async (ticker) => {
        const results = { technical: '', sentiment: '', fundamental: '' };
        try { results.technical = await runTechnical(supabase, ticker, dateStr, cronCfg); } catch (e) { results.technical = `error: ${e instanceof Error ? e.message : e}`; }
        try { results.sentiment = await runSentiment(supabase, ticker, dateStr, anthropic, cronCfg); } catch (e) { results.sentiment = `error: ${e instanceof Error ? e.message : e}`; }
        try { results.fundamental = await runFundamental(supabase, ticker, dateStr); } catch (e) { results.fundamental = `error: ${e instanceof Error ? e.message : e}`; }
        scoreResults[ticker] = results;

        const ok = Object.values(results).every((v) => v.startsWith('ok') || v.startsWith('n/a') || v.startsWith('baseline') || v.startsWith('missing') || v.startsWith('decayed'));
        if (ok) totalSuccess++; else totalErrors++;
      }),
    );

    if (i + 5 < tickers.length) await new Promise((r) => setTimeout(r, 300));
  }

  // Market regime
  console.log('[Cron/Scores] Running market regime...');
  let regimeResult = 'ok';
  try { await runRegime(supabase, dateStr); } catch (e) { regimeResult = `error: ${e instanceof Error ? e.message : e}`; }

  // Conclusions
  console.log('[Cron/Scores] Generating conclusions...');
  let conclusionResult = { generated: 0, errors: 0 };
  try { conclusionResult = await generateConclusions(supabase, anthropic, dateStr, cronCfg); } catch (e) { console.error('[Cron/Scores] Conclusion generation failed:', e); }

  const completedAt = new Date().toISOString();
  console.log(`[Cron/Scores] Done at ${completedAt}: ${totalSuccess} tickers scored, ${totalErrors} errors, ${conclusionResult.generated} conclusions`);

  return NextResponse.json({
    startedAt, completedAt, date: dateStr,
    scores: { success: totalSuccess, errors: totalErrors },
    regime: regimeResult,
    conclusions: conclusionResult,
  });
}

export const maxDuration = 300;
