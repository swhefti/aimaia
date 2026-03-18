import Anthropic from '@anthropic-ai/sdk';
import { createSupabaseClient } from '../../../shared/lib/supabase.js';
import { ASSET_UNIVERSE, ASSET_TYPE_MAP } from '../../../shared/lib/constants.js';

const MODEL = 'claude-sonnet-4-20250514';
const MAX_CHARS = 450;

interface ConclusionResult {
  ticker: string;
  conclusion: string;
  date: string;
}

export async function generateConclusions(
  tickers?: string[],
  date?: Date
): Promise<{ generated: number; skipped: number; errors: number }> {
  const supabase = createSupabaseClient();
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    console.error('[Conclusions] ANTHROPIC_API_KEY not set');
    return { generated: 0, skipped: 0, errors: 0 };
  }

  const anthropic = new Anthropic({ apiKey });
  const dateStr = (date ?? new Date()).toISOString().split('T')[0]!;
  const targetTickers = tickers ?? [...ASSET_UNIVERSE];

  // Check which tickers already have today's conclusion
  const { data: existingRows } = await supabase
    .from('ticker_conclusions')
    .select('ticker')
    .eq('date', dateStr)
    .in('ticker', targetTickers);

  const existingSet = new Set((existingRows ?? []).map((r) => r.ticker as string));
  const needGeneration = targetTickers.filter((t) => !existingSet.has(t));

  if (needGeneration.length === 0) {
    console.log(`[Conclusions] All ${targetTickers.length} tickers already have conclusions for ${dateStr}`);
    return { generated: 0, skipped: targetTickers.length, errors: 0 };
  }

  console.log(`[Conclusions] Generating for ${needGeneration.length} tickers (${existingSet.size} already done)`);

  // Batch-fetch all data we need
  const [allScores, allNews, allAssets, allFundamentals, allQuotes, prevConclusions] = await Promise.all([
    fetchAllScores(supabase, dateStr),
    fetchAllNews(supabase, needGeneration),
    fetchAllAssets(supabase),
    fetchAllFundamentals(supabase),
    fetchAllQuotes(supabase),
    fetchPreviousConclusions(supabase, needGeneration),
  ]);

  let generated = 0;
  let errors = 0;

  // Process in batches of 5 to avoid rate limits
  for (let i = 0; i < needGeneration.length; i += 5) {
    const batch = needGeneration.slice(i, i + 5);
    const results = await Promise.allSettled(
      batch.map((ticker) =>
        generateOne(anthropic, ticker, dateStr, {
          scores: allScores[ticker] ?? {},
          news: allNews[ticker] ?? [],
          asset: allAssets[ticker],
          fundamentals: allFundamentals[ticker],
          quote: allQuotes[ticker],
          prevConclusion: prevConclusions[ticker],
        })
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        const { error } = await supabase
          .from('ticker_conclusions')
          .upsert(
            { ticker: result.value.ticker, date: result.value.date, conclusion: result.value.conclusion },
            { onConflict: 'ticker,date' }
          );
        if (error) {
          console.error(`[Conclusions] DB error for ${result.value.ticker}:`, error.message);
          errors++;
        } else {
          generated++;
        }
      } else {
        errors++;
        if (result.status === 'rejected') {
          console.error(`[Conclusions] Generation failed:`, result.reason);
        }
      }
    }

    if (i + 5 < needGeneration.length) {
      // Small delay between batches
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  console.log(`[Conclusions] Done: ${generated} generated, ${existingSet.size} skipped, ${errors} errors`);
  return { generated, skipped: existingSet.size, errors };
}

async function generateOne(
  anthropic: Anthropic,
  ticker: string,
  dateStr: string,
  ctx: {
    scores: Record<string, { score: number; confidence: number; explanation: string }>;
    news: { headline: string; source: string }[];
    asset?: { name: string; asset_type: string } | undefined;
    fundamentals?: { pe_ratio: number | null; revenue_growth_yoy: number | null; profit_margin: number | null; market_cap: number | null } | undefined;
    quote?: { last_price: number; pct_change: number } | undefined;
    prevConclusion?: { date: string; conclusion: string } | undefined;
  }
): Promise<ConclusionResult> {
  const assetName = ctx.asset?.name ?? ticker;
  const assetType = ctx.asset?.asset_type ?? 'stock';

  const scoreParts: string[] = [];
  for (const [type, s] of Object.entries(ctx.scores)) {
    scoreParts.push(`${type}: ${s.score} (confidence ${s.confidence})${s.explanation ? ' — ' + s.explanation : ''}`);
  }

  const newsParts = ctx.news.map((n) => `"${n.headline}" (${n.source})`);

  let fundPart = '';
  if (ctx.fundamentals) {
    const f = ctx.fundamentals;
    const parts: string[] = [];
    if (f.pe_ratio != null) parts.push(`P/E ${f.pe_ratio.toFixed(1)}`);
    if (f.revenue_growth_yoy != null) parts.push(`revenue growth ${(f.revenue_growth_yoy * 100).toFixed(1)}%`);
    if (f.profit_margin != null) parts.push(`profit margin ${(f.profit_margin * 100).toFixed(1)}%`);
    if (f.market_cap != null) parts.push(`market cap $${(f.market_cap / 1e9).toFixed(1)}B`);
    if (parts.length > 0) fundPart = `Fundamentals: ${parts.join(', ')}`;
  }

  const quotePart = ctx.quote
    ? `Price: $${ctx.quote.last_price.toFixed(2)}, change: ${(ctx.quote.pct_change * 100).toFixed(2)}%`
    : '';

  const prevPart = ctx.prevConclusion
    ? `Previous conclusion (${ctx.prevConclusion.date}): ${ctx.prevConclusion.conclusion}`
    : '';

  const systemPrompt = `You are the MAIPA synthesis agent. Write a single paragraph of exactly 3 to 5 sentences (max ${MAX_CHARS} characters) analyzing ${assetName} (${ticker}), a ${assetType}.

Structure:
1. One sentence: what ${assetName} is or does, with its current price if available.
2. One or two sentences: what the agent scores collectively signal — weave technical, sentiment, fundamental scores and market regime into a coherent picture.
3. One sentence: the current news situation and its implications.

Rules:
- Single paragraph, no bullets, no headers.
- Max ${MAX_CHARS} characters total.
- Be specific: cite score values, price levels, growth figures.
- If a previous conclusion exists, note meaningful changes naturally.
- Never give advice. State signals and observations only.
- Output ONLY the paragraph text.`;

  const userPrompt = `${quotePart}
Scores: ${scoreParts.join('; ') || 'None available'}
${fundPart}
News: ${newsParts.join('; ') || 'No recent news'}
${prevPart}`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  let conclusion = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  // Enforce character limit
  if (conclusion.length > MAX_CHARS) {
    // Truncate at last sentence boundary within limit
    const truncated = conclusion.slice(0, MAX_CHARS);
    const lastPeriod = truncated.lastIndexOf('.');
    if (lastPeriod > MAX_CHARS * 0.5) {
      conclusion = truncated.slice(0, lastPeriod + 1);
    } else {
      conclusion = truncated.trimEnd() + '...';
    }
  }

  return { ticker, conclusion, date: dateStr };
}

// ---------- Data fetching helpers ----------

async function fetchAllScores(supabase: ReturnType<typeof createSupabaseClient>, dateStr: string) {
  // Get latest full pipeline date
  const { data: dateRow } = await supabase
    .from('agent_scores')
    .select('date')
    .eq('agent_type', 'technical')
    .order('date', { ascending: false })
    .limit(1);

  const baseDate = (dateRow?.[0]?.date as string) ?? dateStr;

  const { data: base } = await supabase
    .from('agent_scores')
    .select('ticker, agent_type, score, confidence, explanation')
    .eq('date', baseDate)
    .limit(2000);

  // Also get newer scores
  const { data: newer } = await supabase
    .from('agent_scores')
    .select('ticker, agent_type, score, confidence, explanation')
    .gt('date', baseDate)
    .lte('date', dateStr)
    .order('date', { ascending: false })
    .limit(2000);

  const result: Record<string, Record<string, { score: number; confidence: number; explanation: string }>> = {};
  // Base first, then newer overrides
  for (const row of [...(base ?? []), ...(newer ?? [])]) {
    const t = row.ticker as string;
    const at = row.agent_type as string;
    if (!result[t]) result[t] = {};
    // Newer entries come after base, so they overwrite
    result[t][at] = {
      score: Number(row.score),
      confidence: Number(row.confidence),
      explanation: (row.explanation as string) ?? '',
    };
  }
  return result;
}

async function fetchAllNews(supabase: ReturnType<typeof createSupabaseClient>, tickers: string[]) {
  if (tickers.length === 0) return {};
  const { data } = await supabase
    .from('news_data')
    .select('ticker, headline, source')
    .in('ticker', tickers)
    .order('published_at', { ascending: false })
    .limit(tickers.length * 3); // ~3 per ticker

  const result: Record<string, { headline: string; source: string }[]> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!result[t]) result[t] = [];
    if (result[t].length < 3) {
      result[t].push({ headline: row.headline as string, source: row.source as string });
    }
  }
  return result;
}

async function fetchAllAssets(supabase: ReturnType<typeof createSupabaseClient>) {
  const { data } = await supabase.from('assets').select('ticker, name, asset_type');
  const result: Record<string, { name: string; asset_type: string }> = {};
  for (const row of data ?? []) {
    result[row.ticker as string] = { name: row.name as string, asset_type: row.asset_type as string };
  }
  return result;
}

async function fetchAllFundamentals(supabase: ReturnType<typeof createSupabaseClient>) {
  const { data } = await supabase
    .from('fundamental_data')
    .select('ticker, pe_ratio, revenue_growth_yoy, profit_margin, market_cap')
    .order('date', { ascending: false })
    .limit(2000);

  const result: Record<string, { pe_ratio: number | null; revenue_growth_yoy: number | null; profit_margin: number | null; market_cap: number | null }> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!result[t]) {
      result[t] = {
        pe_ratio: row.pe_ratio != null ? Number(row.pe_ratio) : null,
        revenue_growth_yoy: row.revenue_growth_yoy != null ? Number(row.revenue_growth_yoy) : null,
        profit_margin: row.profit_margin != null ? Number(row.profit_margin) : null,
        market_cap: row.market_cap != null ? Number(row.market_cap) : null,
      };
    }
  }
  return result;
}

async function fetchAllQuotes(supabase: ReturnType<typeof createSupabaseClient>) {
  const { data } = await supabase
    .from('market_quotes')
    .select('ticker, last_price, pct_change')
    .order('date', { ascending: false })
    .limit(2000);

  const result: Record<string, { last_price: number; pct_change: number }> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!result[t]) {
      result[t] = { last_price: Number(row.last_price), pct_change: Number(row.pct_change) };
    }
  }
  return result;
}

async function fetchPreviousConclusions(supabase: ReturnType<typeof createSupabaseClient>, tickers: string[]) {
  if (tickers.length === 0) return {};
  const { data } = await supabase
    .from('ticker_conclusions')
    .select('ticker, date, conclusion')
    .in('ticker', tickers)
    .order('date', { ascending: false })
    .limit(tickers.length); // 1 per ticker

  const result: Record<string, { date: string; conclusion: string }> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!result[t]) {
      result[t] = { date: row.date as string, conclusion: row.conclusion as string };
    }
  }
  return result;
}
