import Anthropic from '@anthropic-ai/sdk';
import type { AgentScore } from '../../shared/types/scores.js';
import { createSupabaseClient } from '../../shared/lib/supabase.js';
import { SENTIMENT_DECAY_FACTOR, ASSET_TYPE_MAP } from '../../shared/lib/constants.js';

const AGENT_VERSION = '1.1.0';
const SENTIMENT_MODEL = 'claude-haiku-4-5-20251001';
const CRYPTO_MIN_QUALIFYING_ARTICLES = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface SentimentLLMResponse {
  sentiment_score: number;
  confidence: number;
  key_themes: string[];
  reasoning: string;
}

interface RelevanceFilterResult {
  is_primary_subject: boolean;
}

type NewsItem = { headline: string; summary: string | null; source: string; published_at: string };

/**
 * For crypto tickers, ask the LLM whether each article has the ticker
 * as its primary subject. Returns only articles that pass the filter.
 */
async function filterCryptoRelevance(
  ticker: string,
  newsItems: NewsItem[]
): Promise<NewsItem[]> {
  const anthropic = new Anthropic();

  // Build a batch prompt — classify all articles in one call to save tokens/latency
  const articleList = newsItems
    .map((n, i) => `${i + 1}. ${n.headline}${n.summary ? ` — ${n.summary}` : ''}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: SENTIMENT_MODEL,
    max_tokens: 300,
    system: `You classify whether a crypto asset is the PRIMARY subject of news articles. The asset must be the main topic — not a passing mention, comparison, or secondary reference. Return ONLY valid JSON, no preamble.`,
    messages: [
      {
        role: 'user',
        content: `Asset: ${ticker}\n\nArticles:\n${articleList}\n\nFor each article, return a JSON array of booleans indicating whether ${ticker} is the PRIMARY subject:\n{"results": [true/false, ...]}`,
      },
    ],
  });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  try {
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned) as { results: boolean[] };
    const results = parsed.results ?? [];

    return newsItems.filter((_, i) => results[i] === true);
  } catch {
    // If parsing fails, be conservative and include all articles
    console.warn(`[Sentiment] Relevance filter parse failed for ${ticker}, including all articles`);
    return newsItems;
  }
}

async function analyzeSentiment(
  ticker: string,
  newsItems: NewsItem[]
): Promise<SentimentLLMResponse> {
  const anthropic = new Anthropic();

  const newsList = newsItems
    .map((n, i) => `${i + 1}. [${n.published_at}] (${n.source}) ${n.headline}${n.summary ? ` — ${n.summary}` : ''}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: SENTIMENT_MODEL,
    max_tokens: 300,
    system: `You are a financial sentiment analyst. Analyze the provided news headlines and summaries for ${ticker}. Return ONLY valid JSON, no preamble.`,
    messages: [
      {
        role: 'user',
        content: `Analyze these ${newsItems.length} news items from the last 10 days:\n${newsList}\n\nReturn JSON:\n{\n  "sentiment_score": float (-1.0 to +1.0),\n  "confidence": float (0.0 to 1.0),\n  "key_themes": string[],\n  "reasoning": string (max 100 words)\n}`,
      },
    ],
  });

  const rawText = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const cleaned = rawText.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned) as SentimentLLMResponse;

  return {
    sentiment_score: clamp(parsed.sentiment_score, -1, 1),
    confidence: clamp(parsed.confidence, 0, 1),
    key_themes: parsed.key_themes ?? [],
    reasoning: parsed.reasoning ?? '',
  };
}

export async function run(ticker: string, date: Date): Promise<AgentScore> {
  const supabase = createSupabaseClient();
  const dateStr = date.toISOString().split('T')[0]!;
  const tenDaysAgo = new Date(date);
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const tenDaysAgoStr = tenDaysAgo.toISOString().split('T')[0]!;

  const isCrypto = ASSET_TYPE_MAP[ticker] === 'crypto';

  // Fetch recent news
  const { data: newsData, error: newsError } = await supabase
    .from('news_data')
    .select('headline, summary, source, published_at')
    .eq('ticker', ticker)
    .gte('published_at', tenDaysAgoStr)
    .lte('published_at', dateStr + 'T23:59:59Z')
    .order('published_at', { ascending: false })
    .limit(20);

  if (newsError) {
    console.error(`[Sentiment] DB error for ${ticker}:`, newsError.message);
    throw new Error(`Failed to fetch news_data for ${ticker}: ${newsError.message}`);
  }

  let newsItems: NewsItem[] = (newsData ?? []) as NewsItem[];

  // For crypto: filter articles to only those where the ticker is the primary subject
  let totalFetched = newsItems.length;
  if (isCrypto && newsItems.length > 0) {
    try {
      newsItems = await filterCryptoRelevance(ticker, newsItems);
      console.log(`[Sentiment] ${ticker}: ${totalFetched} articles → ${newsItems.length} primary-subject after filter`);
    } catch (err) {
      console.warn(`[Sentiment] Relevance filter failed for ${ticker}, falling back to all articles:`, err);
      // Keep all articles if filter fails
    }
  }

  // No qualifying news (or fewer than threshold for crypto)
  const insufficientNews = newsItems.length === 0 || (isCrypto && newsItems.length < CRYPTO_MIN_QUALIFYING_ARTICLES);

  if (insufficientNews) {
    if (isCrypto) {
      // Crypto with insufficient qualifying articles: write missing score with null-like 0
      const agentScore: AgentScore = {
        ticker,
        date: dateStr,
        agentType: 'sentiment',
        score: 0,
        confidence: 0,
        componentScores: { newsCount: totalFetched, qualifyingCount: newsItems.length, minRequired: CRYPTO_MIN_QUALIFYING_ARTICLES },
        explanation: newsItems.length === 0
          ? 'No news articles where this asset is the primary subject.'
          : `Only ${newsItems.length} qualifying article(s) — below minimum of ${CRYPTO_MIN_QUALIFYING_ARTICLES}. Sentiment score omitted.`,
        dataFreshness: 'missing',
        agentVersion: AGENT_VERSION,
      };
      await writeToDB(supabase, agentScore);
      return agentScore;
    }

    // Stock/ETF with no news: apply decay as before
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0]!;

    const { data: prevScore } = await supabase
      .from('agent_scores')
      .select('score')
      .eq('ticker', ticker)
      .eq('agent_type', 'sentiment')
      .eq('date', yesterdayStr)
      .single();

    const decayedScore = prevScore ? clamp(Number(prevScore.score) * SENTIMENT_DECAY_FACTOR, -1, 1) : 0;

    const agentScore: AgentScore = {
      ticker,
      date: dateStr,
      agentType: 'sentiment',
      score: decayedScore,
      confidence: 0.1,
      componentScores: { newsCount: 0, decayApplied: prevScore ? 1 : 0 },
      explanation: prevScore
        ? `No new news. Decayed previous sentiment score by ${SENTIMENT_DECAY_FACTOR}.`
        : 'No news data available for this ticker.',
      dataFreshness: 'missing',
      agentVersion: AGENT_VERSION,
    };

    await writeToDB(supabase, agentScore);
    return agentScore;
  }

  // Has qualifying news — call LLM for sentiment analysis
  try {
    const result = await analyzeSentiment(ticker, newsItems);

    // Confidence adjustment based on number and recency
    const todayNews = newsItems.filter((n) => n.published_at.startsWith(dateStr));
    let adjustedConfidence = result.confidence;
    if (newsItems.length >= 5) adjustedConfidence = Math.min(adjustedConfidence + 0.1, 1);
    if (todayNews.length > 0) adjustedConfidence = Math.min(adjustedConfidence + 0.1, 1);

    const agentScore: AgentScore = {
      ticker,
      date: dateStr,
      agentType: 'sentiment',
      score: result.sentiment_score,
      confidence: adjustedConfidence,
      componentScores: {
        rawScore: result.sentiment_score,
        newsCount: totalFetched,
        qualifyingCount: newsItems.length,
        todayNewsCount: todayNews.length,
      },
      explanation: `${result.reasoning} Key themes: ${result.key_themes.join(', ')}`,
      dataFreshness: todayNews.length > 0 ? 'current' : 'stale',
      agentVersion: AGENT_VERSION,
    };

    await writeToDB(supabase, agentScore);
    return agentScore;
  } catch (err) {
    console.error(`[Sentiment] LLM call failed for ${ticker}:`, err);

    // Fallback: apply decay from yesterday
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0]!;

    const { data: prevScore } = await supabase
      .from('agent_scores')
      .select('score')
      .eq('ticker', ticker)
      .eq('agent_type', 'sentiment')
      .eq('date', yesterdayStr)
      .single();

    const fallbackScore = prevScore ? clamp(Number(prevScore.score) * SENTIMENT_DECAY_FACTOR, -1, 1) : 0;

    const agentScore: AgentScore = {
      ticker,
      date: dateStr,
      agentType: 'sentiment',
      score: fallbackScore,
      confidence: 0.2,
      componentScores: { newsCount: totalFetched, qualifyingCount: newsItems.length, llmFailed: 1 },
      explanation: 'LLM sentiment analysis failed. Using decayed previous score as fallback.',
      dataFreshness: 'stale',
      agentVersion: AGENT_VERSION,
    };

    await writeToDB(supabase, agentScore);
    return agentScore;
  }
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
    console.error(`[Sentiment] Upsert error for ${agentScore.ticker}:`, error.message);
  }
}

export async function runBatch(tickers: string[], date: Date): Promise<AgentScore[]> {
  const results: AgentScore[] = [];
  const batchSize = 10;

  for (let i = 0; i < tickers.length; i += batchSize) {
    const batch = tickers.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((ticker) =>
        run(ticker, date).catch((err) => {
          console.error(`[Sentiment] Failed for ${ticker}:`, err);
          return null;
        })
      )
    );
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    // Brief pause between batches to respect rate limits
    if (i + batchSize < tickers.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
}
