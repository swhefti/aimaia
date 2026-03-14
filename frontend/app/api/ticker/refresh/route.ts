import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { ASSET_TYPE_MAP, CRYPTO } from '@shared/lib/constants';
import { getConfig, getConfigNumber, getConfigNumberBatch } from '@/lib/config';
import { extractJson } from '@/lib/json-parser';

/**
 * POST /api/ticker/refresh
 * Dev tool: refreshes price, agent scores, and conclusion for a single ticker.
 * Body: { ticker: string }
 */

const CRYPTO_SET = new Set(CRYPTO);

const CRYPTO_TWELVE_DATA_MAP: Record<string, string> = {
  BTC: 'BTC/USD', ETH: 'ETH/USD', BNB: 'BNB/USD', SOL: 'SOL/USD',
  XRP: 'XRP/USD', ADA: 'ADA/USD', AVAX: 'AVAX/USD', DOT: 'DOT/USD',
  LINK: 'LINK/USD', MATIC: 'MATIC/USD', LTC: 'LTC/USD', BCH: 'BCH/USD',
  ATOM: 'ATOM/USD', UNI: 'UNI/USD', AAVE: 'AAVE/USD', FIL: 'FIL/USD',
  ICP: 'ICP/USD', ALGO: 'ALGO/USD', XLM: 'XLM/USD', VET: 'VET/USD',
};

function toTwelveData(ticker: string): string {
  if (CRYPTO_SET.has(ticker)) return CRYPTO_TWELVE_DATA_MAP[ticker] ?? `${ticker}/USD`;
  return ticker;
}

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ---- Step 1: Fetch price from TwelveData ----

async function refreshPrice(supabase: ReturnType<typeof getServiceSupabase>, ticker: string): Promise<string> {
  const apiKey = process.env['TWELVE_DATA_API_KEY'];
  if (!apiKey) return 'skipped (no TWELVE_DATA_API_KEY)';

  const symbol = toTwelveData(ticker);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=5&apikey=${apiKey}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const json = await resp.json() as { values?: { datetime: string; open: string; high: string; low: string; close: string; volume: string }[]; status?: string; message?: string };

  if (json.status === 'error' || !json.values?.length) {
    return `failed: ${json.message ?? 'no data'}`;
  }

  const rows = json.values
    .filter((d) => parseFloat(d.close) > 0)
    .map((d) => ({
      ticker,
      date: d.datetime,
      open: parseFloat(d.open),
      high: parseFloat(d.high),
      low: parseFloat(d.low),
      close: parseFloat(d.close),
      volume: parseInt(d.volume) || 0,
    }));

  if (rows.length === 0) return 'no valid prices';

  const { error: priceErr } = await supabase.from('price_history').upsert(rows, { onConflict: 'ticker,date' });
  if (priceErr) return `price_history error: ${priceErr.message}`;

  // Update market_quotes with latest
  const latest = rows[0]!;
  const prev = rows.length > 1 ? rows[1]! : latest;
  const dailyChange = latest.close - prev.close;
  const pctChange = prev.close !== 0 ? dailyChange / prev.close : 0;
  await supabase.from('market_quotes').upsert(
    { ticker, date: latest.date, last_price: latest.close, daily_change: dailyChange, pct_change: pctChange },
    { onConflict: 'ticker,date' }
  );

  return `ok (${rows.length} days)`;
}

// ---- Step 2: Technical scoring (pure math) ----

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

async function runTechnical(supabase: ReturnType<typeof getServiceSupabase>, ticker: string, dateStr: string): Promise<string> {
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
  const macdLine: number[] = ema12.map((v, i) => v - ema26[i]!);
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

  const subWeights = await getConfigNumberBatch({
    subweight_technical_macd: 0.30,
    subweight_technical_ema: 0.25,
    subweight_technical_rsi: 0.20,
    subweight_technical_bollinger: 0.15,
    subweight_technical_volume: 0.10,
  });
  const score = clamp(
    macdScore * subWeights.subweight_technical_macd! +
    emaScore * subWeights.subweight_technical_ema! +
    rsiScore * subWeights.subweight_technical_rsi! +
    bollScore * subWeights.subweight_technical_bollinger! +
    volScore * subWeights.subweight_technical_volume!,
    -1, 1
  );
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

// ---- Step 3: Sentiment scoring (LLM) ----

async function runSentiment(supabase: ReturnType<typeof getServiceSupabase>, ticker: string, dateStr: string): Promise<string> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return 'skipped (no ANTHROPIC_API_KEY)';

  const sentimentLookbackDays = await getConfigNumber('sentiment_lookback_days', 10);
  const SENTIMENT_MODEL = await getConfig('model_sentiment', 'claude-haiku-4-5-20251001');
  const CRYPTO_MIN_QUALIFYING = await getConfigNumber('sentiment_min_articles_crypto', 3);
  const sentimentDecay = await getConfigNumber('sentiment_decay_factor', 0.9);
  const maxTokensSent = await getConfigNumber('max_tokens_sentiment', 300);
  const promptSentiment = await getConfig('prompt_sentiment', 'You are a financial sentiment analyst. Analyze news for {{ticker}}. Return ONLY valid JSON.');
  const promptFilter = await getConfig('prompt_sentiment_filter', 'You classify whether a crypto asset is the PRIMARY subject of news articles. Return ONLY valid JSON.');

  const tenDaysAgo = new Date(dateStr);
  tenDaysAgo.setDate(tenDaysAgo.getDate() - sentimentLookbackDays);
  const tenDaysAgoStr = tenDaysAgo.toISOString().split('T')[0]!;
  const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';

  const { data: newsData } = await supabase
    .from('news_data').select('headline, summary, source, published_at')
    .eq('ticker', ticker).gte('published_at', tenDaysAgoStr).lte('published_at', dateStr + 'T23:59:59Z')
    .order('published_at', { ascending: false }).limit(20);

  let newsItems = (newsData ?? []) as { headline: string; summary: string | null; source: string; published_at: string }[];
  const totalFetched = newsItems.length;

  const anthropic = new Anthropic({ apiKey });

  // Crypto relevance filter
  if (isCrypto && newsItems.length > 0) {
    try {
      const articleList = newsItems.map((n, i) => `${i + 1}. ${n.headline}${n.summary ? ` — ${n.summary}` : ''}`).join('\n');
      const filterResp = await anthropic.messages.create({
        model: SENTIMENT_MODEL, max_tokens: maxTokensSent,
        system: promptFilter,
        messages: [{ role: 'user', content: `Asset: ${ticker}\n\nArticles:\n${articleList}\n\nReturn: {"results": [true/false, ...]}` }],
      });
      const rawText = filterResp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
      const parsed = extractJson(rawText) as { results: boolean[] };
      newsItems = newsItems.filter((_, i) => parsed.results[i] === true);
    } catch { /* keep all on failure */ }
  }

  const insufficientNews = newsItems.length === 0 || (isCrypto && newsItems.length < CRYPTO_MIN_QUALIFYING);

  if (insufficientNews) {
    if (isCrypto) {
      await upsertScore(supabase, ticker, dateStr, 'sentiment', 0, 0, { newsCount: totalFetched, qualifyingCount: newsItems.length }, 'Insufficient qualifying articles', 'missing');
      return `missing (${newsItems.length}/${CRYPTO_MIN_QUALIFYING} articles)`;
    }
    // Stock/ETF: decay
    const yesterday = new Date(dateStr);
    yesterday.setDate(yesterday.getDate() - 1);
    const { data: prev } = await supabase.from('agent_scores').select('score').eq('ticker', ticker).eq('agent_type', 'sentiment').eq('date', yesterday.toISOString().split('T')[0]!).single();
    const decayed = prev ? clamp(Number(prev.score) * sentimentDecay, -1, 1) : 0;
    await upsertScore(supabase, ticker, dateStr, 'sentiment', decayed, 0.1, { newsCount: 0, decayApplied: prev ? 1 : 0 }, 'No news, decayed previous', 'missing');
    return `decayed (score=${decayed.toFixed(2)})`;
  }

  // LLM sentiment analysis
  const newsList = newsItems.map((n, i) => `${i + 1}. [${n.published_at}] (${n.source}) ${n.headline}${n.summary ? ` — ${n.summary}` : ''}`).join('\n');
  const resp = await anthropic.messages.create({
    model: SENTIMENT_MODEL, max_tokens: maxTokensSent,
    system: promptSentiment.replace(/\{\{ticker\}\}/g, ticker),
    messages: [{ role: 'user', content: `Articles:\n${newsList}\n\nReturn: {"sentiment_score": float, "confidence": float, "key_themes": string[], "reasoning": string}` }],
  });

  const rawText = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');

  let parsed: { sentiment_score: number; confidence: number; key_themes: string[]; reasoning: string };
  try {
    parsed = extractJson(rawText) as typeof parsed;
    if (typeof parsed.sentiment_score !== 'number') throw new Error('missing sentiment_score');
  } catch (parseErr) {
    console.warn(`[Refresh] ${ticker}: sentiment parse failed (${parseErr instanceof Error ? parseErr.message : parseErr}), using fallback`);
    if (isCrypto) {
      await upsertScore(supabase, ticker, dateStr, 'sentiment', 0, 0.1, { newsCount: totalFetched, parseFallback: 1 }, 'Sentiment parse failed, neutral fallback', 'stale');
      return `parse-fallback (crypto neutral)`;
    }
    const yesterday = new Date(dateStr);
    yesterday.setDate(yesterday.getDate() - 1);
    const { data: prev } = await supabase.from('agent_scores').select('score').eq('ticker', ticker).eq('agent_type', 'sentiment').eq('date', yesterday.toISOString().split('T')[0]!).single();
    const decayed = prev ? clamp(Number(prev.score) * sentimentDecay, -1, 1) : 0;
    await upsertScore(supabase, ticker, dateStr, 'sentiment', decayed, 0.1, { newsCount: totalFetched, decayApplied: prev ? 1 : 0, parseFallback: 1 }, 'Sentiment parse failed, decayed previous', 'stale');
    return `parse-fallback (decayed=${decayed.toFixed(2)})`;
  }

  const score = clamp(parsed.sentiment_score, -1, 1);
  const todayNews = newsItems.filter((n) => n.published_at.startsWith(dateStr));
  let conf = clamp(parsed.confidence, 0, 1);
  if (newsItems.length >= 5) conf = Math.min(conf + 0.1, 1);
  if (todayNews.length > 0) conf = Math.min(conf + 0.1, 1);

  const explanation = `${parsed.reasoning} Key themes: ${(parsed.key_themes ?? []).join(', ')}`;
  await upsertScore(supabase, ticker, dateStr, 'sentiment', score, conf, { rawScore: score, newsCount: totalFetched, qualifyingCount: newsItems.length, todayNewsCount: todayNews.length }, explanation, todayNews.length > 0 ? 'current' : 'stale');
  return `ok (score=${score.toFixed(2)})`;
}

// ---- Step 4b: Market Regime scoring ----

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

async function fetchCloses(supabase: ReturnType<typeof getServiceSupabase>, ticker: string, dateStr: string): Promise<number[]> {
  const { data } = await supabase.from('price_history').select('close').eq('ticker', ticker).lte('date', dateStr).order('date', { ascending: true }).limit(250);
  return (data ?? []).map((r) => Number(r.close));
}

async function runRegime(supabase: ReturnType<typeof getServiceSupabase>, dateStr: string): Promise<string> {
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
      spyTrendScore, volatilityScore: volScore, sectorRotationScore: sectorScore,
      regimeLabel: label,
      volatilityLevel: vol < 0.10 ? 'low' : vol < 0.20 ? 'moderate' : 'high',
      broadTrend: spyTrendScore > 0.2 ? 'uptrend' : spyTrendScore < -0.2 ? 'downtrend' : 'sideways',
      sectorRotation: sectorScore > 0.1 ? 'risk-on' : sectorScore < -0.1 ? 'risk-off' : 'balanced',
    };
    await upsertScore(supabase, 'MARKET', dateStr, 'market_regime', regimeScore, trendConfidence, components as unknown as Record<string, number>, `Stock regime: ${label} (${regimeScore.toFixed(2)})`, 'current');
  } else {
    await upsertScore(supabase, 'MARKET', dateStr, 'market_regime', 0, 0.1, {}, 'Insufficient SPY data', 'missing');
  }

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
      btcTrendScore, volatilityScore: volScore, altSeasonScore: altScore,
      regimeLabel: label,
      volatilityLevel: vol < 0.40 ? 'low' : vol < 0.80 ? 'moderate' : 'high',
      broadTrend: btcTrendScore > 0.2 ? 'uptrend' : btcTrendScore < -0.2 ? 'downtrend' : 'sideways',
      sectorRotation: altScore > 0.1 ? 'risk-on' : altScore < -0.1 ? 'risk-off' : 'balanced',
    };
    await upsertScore(supabase, 'MARKET_CRYPTO', dateStr, 'market_regime', regimeScore, trendConfidence, components as unknown as Record<string, number>, `Crypto regime: ${label} (${regimeScore.toFixed(2)})`, 'current');
  } else {
    await upsertScore(supabase, 'MARKET_CRYPTO', dateStr, 'market_regime', 0, 0.1, {}, 'Insufficient BTC data', 'missing');
  }

  return 'ok';
}

// ---- Step 4: Fundamental scoring ----

const SECTOR_MEDIAN_PE: Record<string, number> = {
  technology: 28, healthcare: 22, financials: 14, 'consumer cyclical': 20,
  'consumer defensive': 24, industrials: 18, energy: 12, 'real estate': 30,
  utilities: 18, 'communication services': 20, 'basic materials': 15, default: 20,
};

async function runFundamental(supabase: ReturnType<typeof getServiceSupabase>, ticker: string, dateStr: string): Promise<string> {
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

  const components = { peScore, revenueScore: revScore, marginScore, roeScore, debtScore };
  await upsertScore(supabase, ticker, dateStr, 'fundamental', score, confidence, components, `Fundamental ${score.toFixed(2)}`, freshness);
  return `ok (score=${score.toFixed(2)})`;
}

// ---- Step 5: Conclusion generation ----

async function refreshConclusion(supabase: ReturnType<typeof getServiceSupabase>, ticker: string, dateStr: string): Promise<string> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return 'skipped (no ANTHROPIC_API_KEY)';

  const [CONCLUSION_MODEL, MAX_CHARS, maxTokensConc, promptConc] = await Promise.all([
    getConfig('model_conclusion', 'claude-sonnet-4-6'),
    getConfigNumber('max_chars_conclusion', 450),
    getConfigNumber('max_tokens_conclusion', 300),
    getConfig('prompt_conclusion', ''),
  ]);

  // Delete existing conclusion for today so we regenerate
  await supabase.from('ticker_conclusions').delete().eq('ticker', ticker).eq('date', dateStr);

  const anthropic = new Anthropic({ apiKey });

  // Fetch context
  const [scoresRes, newsRes, assetRes, fundRes, quoteRes, prevRes] = await Promise.all([
    supabase.from('agent_scores').select('agent_type, score, confidence, explanation').eq('ticker', ticker).eq('date', dateStr),
    supabase.from('news_data').select('headline, source').eq('ticker', ticker).order('published_at', { ascending: false }).limit(3),
    supabase.from('assets').select('name, asset_type').eq('ticker', ticker).single(),
    supabase.from('fundamental_data').select('pe_ratio, revenue_growth_yoy, profit_margin, market_cap').eq('ticker', ticker).order('date', { ascending: false }).limit(1).single(),
    supabase.from('market_quotes').select('last_price, pct_change').eq('ticker', ticker).order('date', { ascending: false }).limit(1).single(),
    supabase.from('ticker_conclusions').select('date, conclusion').eq('ticker', ticker).order('date', { ascending: false }).limit(1).single(),
  ]);

  const scores: Record<string, { score: number; confidence: number }> = {};
  for (const row of scoresRes.data ?? []) {
    scores[row.agent_type as string] = { score: Number(row.score), confidence: Number(row.confidence) };
  }

  const name = (assetRes.data?.name as string) ?? ticker;
  const assetType = (assetRes.data?.asset_type as string) ?? 'stock';
  const scoreParts = Object.entries(scores).map(([k, v]) => `${k}: ${v.score.toFixed(2)} (conf ${v.confidence.toFixed(2)})`);
  const newsParts = (newsRes.data ?? []).slice(0, 3).map((n) => `"${n.headline}" — ${n.source}`);

  const fundParts: string[] = [];
  if (fundRes.data) {
    const f = fundRes.data;
    if (f.pe_ratio != null) fundParts.push(`P/E ${Number(f.pe_ratio).toFixed(1)}`);
    if (f.revenue_growth_yoy != null) fundParts.push(`rev growth ${(Number(f.revenue_growth_yoy) * 100).toFixed(1)}%`);
    if (f.profit_margin != null) fundParts.push(`margin ${(Number(f.profit_margin) * 100).toFixed(1)}%`);
    if (f.market_cap != null) fundParts.push(`mkt cap $${(Number(f.market_cap) / 1e9).toFixed(1)}B`);
  }

  const priceLine = quoteRes.data ? `Price $${Number(quoteRes.data.last_price).toFixed(2)}, change ${(Number(quoteRes.data.pct_change) * 100).toFixed(2)}%` : '';

  const system = promptConc
    ? promptConc
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{ticker\}\}/g, ticker)
        .replace(/\{\{type\}\}/g, assetType)
        .replace(/\{\{max_chars\}\}/g, String(MAX_CHARS))
    : `Write a single paragraph (3–5 sentences, max ${MAX_CHARS} characters) analyzing ${name} (${ticker}), a ${assetType}.\nSentence 1: Brief intro, current price.\nSentences 2–3: What agent scores collectively signal.\nSentence 4–5: News situation.\nRules: single paragraph, no bullets, max ${MAX_CHARS} chars. Be specific. Never give advice. Output ONLY the paragraph.`;

  const user = [
    priceLine,
    `Scores: ${scoreParts.join('; ') || 'none'}`,
    fundParts.length ? `Fundamentals: ${fundParts.join(', ')}` : '',
    `News: ${newsParts.join('; ') || 'no recent news'}`,
    prevRes.data ? `Previous (${prevRes.data.date}): ${prevRes.data.conclusion}` : '',
  ].filter(Boolean).join('\n');

  const resp = await anthropic.messages.create({
    model: CONCLUSION_MODEL, max_tokens: maxTokensConc, system,
    messages: [{ role: 'user', content: user }],
  });

  let text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim();
  if (text.length > MAX_CHARS) {
    const cut = text.slice(0, MAX_CHARS);
    const lastDot = cut.lastIndexOf('.');
    text = lastDot > MAX_CHARS * 0.5 ? cut.slice(0, lastDot + 1) : cut.trimEnd() + '...';
  }

  const { error } = await supabase.from('ticker_conclusions').upsert(
    { ticker, date: dateStr, conclusion: text },
    { onConflict: 'ticker,date' }
  );

  if (error) return `db error: ${error.message}`;
  return 'ok';
}

// ---- Shared helper ----

async function upsertScore(
  supabase: ReturnType<typeof getServiceSupabase>,
  ticker: string, date: string, agentType: string,
  score: number, confidence: number,
  components: Record<string, number>, explanation: string, freshness: string
) {
  await supabase.from('agent_scores').upsert(
    { ticker, date, agent_type: agentType, score, confidence, component_scores: components, explanation, data_freshness: freshness, agent_version: 'refresh-1.0' },
    { onConflict: 'ticker,date,agent_type' }
  );
}

// ---- Main handler ----

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { ticker?: string };
    const ticker = body.ticker;
    if (!ticker || !ASSET_TYPE_MAP[ticker]) {
      return NextResponse.json({ error: 'Invalid or missing ticker' }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const dateStr = new Date().toISOString().split('T')[0]!;

    const steps: Record<string, string> = {};

    // Step 1: Price
    try { steps.price = await refreshPrice(supabase, ticker); }
    catch (e) { steps.price = `error: ${e instanceof Error ? e.message : String(e)}`; }

    // Steps 2-4: Agent scores (parallel)
    const [techResult, sentResult, fundResult] = await Promise.allSettled([
      runTechnical(supabase, ticker, dateStr),
      runSentiment(supabase, ticker, dateStr),
      runFundamental(supabase, ticker, dateStr),
    ]);

    steps.technical = techResult.status === 'fulfilled' ? techResult.value : `error: ${techResult.reason}`;
    steps.sentiment = sentResult.status === 'fulfilled' ? sentResult.value : `error: ${sentResult.reason}`;
    steps.fundamental = fundResult.status === 'fulfilled' ? fundResult.value : `error: ${fundResult.reason}`;

    // Step 4b: Market regime (global signal, runs once regardless of ticker)
    try { steps.regime = await runRegime(supabase, dateStr); }
    catch (e) { steps.regime = `error: ${e instanceof Error ? e.message : String(e)}`; }

    // Step 5: Conclusion
    try { steps.conclusion = await refreshConclusion(supabase, ticker, dateStr); }
    catch (e) { steps.conclusion = `error: ${e instanceof Error ? e.message : String(e)}`; }

    const allOk = Object.values(steps).every((v) => v.startsWith('ok') || v.startsWith('n/a') || v.startsWith('baseline') || v.startsWith('missing') || v.startsWith('decayed') || v.startsWith('parse-fallback'));

    return NextResponse.json({ ticker, date: dateStr, status: allOk ? 'success' : 'partial', steps });
  } catch (err) {
    console.error('[Refresh] Error:', err);
    return NextResponse.json({ error: 'Refresh failed' }, { status: 500 });
  }
}
