import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { getConfig, getConfigNumber } from '@/lib/config';

function getServiceSupabase() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Missing Supabase env vars');
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * POST /api/ticker/conclusion
 * Generates conclusions for specified tickers (or all if none given).
 * Called by the pipeline after scores + news are written.
 * Body: { tickers?: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { tickers?: string[] };
    const tickers = body.tickers;

    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
    }

    const supabase = getServiceSupabase();
    const anthropic = new Anthropic({ apiKey });
    const today = new Date().toISOString().split('T')[0]!;

    // Determine which tickers to process
    let targetTickers: string[];
    if (tickers && tickers.length > 0) {
      targetTickers = tickers;
    } else {
      // All tickers that have scores
      const { data: scoreTickers } = await supabase
        .from('agent_scores')
        .select('ticker')
        .order('date', { ascending: false })
        .limit(2000);
      const unique = new Set((scoreTickers ?? []).map((r) => r.ticker as string));
      unique.delete('MARKET');
      unique.delete('MARKET_CRYPTO');
      targetTickers = [...unique];
    }

    // Skip tickers that already have today's conclusion
    const { data: existing } = await supabase
      .from('ticker_conclusions')
      .select('ticker')
      .eq('date', today)
      .in('ticker', targetTickers);
    const done = new Set((existing ?? []).map((r) => r.ticker as string));
    const todo = targetTickers.filter((t) => !done.has(t));

    if (todo.length === 0) {
      return NextResponse.json({ generated: 0, skipped: targetTickers.length, message: 'All up to date' });
    }

    // Load config
    const [conclusionModel, maxChars, maxTokens, promptTemplate] = await Promise.all([
      getConfig('model_conclusion', 'claude-sonnet-4-6'),
      getConfigNumber('max_chars_conclusion', 450),
      getConfigNumber('max_tokens_conclusion', 300),
      getConfig('prompt_conclusion', ''),
    ]);

    // Batch-fetch data
    const [allScores, allNews, allAssets, allFundamentals, allQuotes, prevConclusions] = await Promise.all([
      fetchScores(supabase, today),
      fetchNews(supabase, todo),
      fetchAssets(supabase),
      fetchFundamentals(supabase),
      fetchQuotes(supabase),
      fetchPrevConclusions(supabase, todo),
    ]);

    let generated = 0;
    let errors = 0;

    // Process in batches of 5
    for (let i = 0; i < todo.length; i += 5) {
      const batch = todo.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map((ticker) =>
          generateOne(anthropic, ticker, today, {
            scores: allScores[ticker] ?? {},
            news: allNews[ticker] ?? [],
            asset: allAssets[ticker],
            fundamentals: allFundamentals[ticker],
            quote: allQuotes[ticker],
            prev: prevConclusions[ticker],
          }, { model: conclusionModel, maxChars, maxTokens, promptTemplate })
        )
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const { error } = await supabase
            .from('ticker_conclusions')
            .upsert(
              { ticker: result.value.ticker, date: today, conclusion: result.value.conclusion },
              { onConflict: 'ticker,date' }
            );
          if (error) {
            console.error(`[Conclusion] DB error ${result.value.ticker}:`, error.message);
            errors++;
          } else {
            generated++;
          }
        } else {
          errors++;
        }
      }
      if (i + 5 < todo.length) await new Promise((r) => setTimeout(r, 300));
    }

    return NextResponse.json({ generated, skipped: done.size, errors });
  } catch (err) {
    console.error('[Conclusion] Error:', err);
    return NextResponse.json({ error: 'Failed to generate conclusions' }, { status: 500 });
  }
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
    prev?: { date: string; conclusion: string } | undefined;
  },
  cfg: { model: string; maxChars: number; maxTokens: number; promptTemplate: string }
) {
  const name = ctx.asset?.name ?? ticker;
  const type = ctx.asset?.asset_type ?? 'stock';

  const scoreParts = Object.entries(ctx.scores)
    .filter(([k]) => k !== 'market_regime')
    .map(([k, v]) => `${k}: ${v.score.toFixed(2)} (conf ${v.confidence.toFixed(2)})`);
  const regime = ctx.scores['market_regime'];
  if (regime) scoreParts.push(`market regime: ${regime.score.toFixed(2)}`);

  const newsParts = ctx.news.slice(0, 3).map((n) => `"${n.headline}" — ${n.source}`);

  const fundParts: string[] = [];
  if (ctx.fundamentals) {
    const f = ctx.fundamentals;
    if (f.pe_ratio != null) fundParts.push(`P/E ${f.pe_ratio.toFixed(1)}`);
    if (f.revenue_growth_yoy != null) fundParts.push(`rev growth ${(f.revenue_growth_yoy * 100).toFixed(1)}%`);
    if (f.profit_margin != null) fundParts.push(`margin ${(f.profit_margin * 100).toFixed(1)}%`);
    if (f.market_cap != null) fundParts.push(`mkt cap $${(f.market_cap / 1e9).toFixed(1)}B`);
  }

  const priceLine = ctx.quote
    ? `Price $${ctx.quote.last_price.toFixed(2)}, change ${(ctx.quote.pct_change * 100).toFixed(2)}%`
    : '';

  const system = cfg.promptTemplate
    ? cfg.promptTemplate
        .replace(/\{\{name\}\}/g, name)
        .replace(/\{\{ticker\}\}/g, ticker)
        .replace(/\{\{type\}\}/g, type)
        .replace(/\{\{max_chars\}\}/g, String(cfg.maxChars))
    : `Write a single paragraph (3–5 sentences, max ${cfg.maxChars} characters) analyzing ${name} (${ticker}), a ${type}.

Sentence 1: Brief intro — what ${name} is/does, current price.
Sentences 2–3: What the agent scores collectively signal (technical, sentiment, fundamental, market regime) — weave into one picture.
Sentence 4–5: Current news situation and implications.

Rules: single paragraph, no bullets/headers, max ${cfg.maxChars} chars. Be specific with numbers. Never give advice. Output ONLY the paragraph.`;

  const user = [
    priceLine,
    `Scores: ${scoreParts.join('; ') || 'none'}`,
    fundParts.length ? `Fundamentals: ${fundParts.join(', ')}` : '',
    `News: ${newsParts.join('; ') || 'no recent news'}`,
    ctx.prev ? `Previous (${ctx.prev.date}): ${ctx.prev.conclusion}` : '',
  ].filter(Boolean).join('\n');

  const resp = await anthropic.messages.create({
    model: cfg.model,
    max_tokens: cfg.maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });

  let text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  if (text.length > cfg.maxChars) {
    const cut = text.slice(0, cfg.maxChars);
    const lastDot = cut.lastIndexOf('.');
    text = lastDot > cfg.maxChars * 0.5 ? cut.slice(0, lastDot + 1) : cut.trimEnd() + '...';
  }

  return { ticker, conclusion: text, date: dateStr };
}

// ---------- Data fetchers ----------

async function fetchScores(sb: ReturnType<typeof getServiceSupabase>, dateStr: string) {
  const { data: dateRow } = await sb.from('agent_scores').select('date').eq('agent_type', 'technical').order('date', { ascending: false }).limit(1);
  const baseDate = (dateRow?.[0]?.date as string) ?? dateStr;
  const { data: base } = await sb.from('agent_scores').select('ticker, agent_type, score, confidence, explanation').eq('date', baseDate).limit(2000);
  const { data: newer } = await sb.from('agent_scores').select('ticker, agent_type, score, confidence, explanation').gt('date', baseDate).lte('date', dateStr).limit(2000);
  const r: Record<string, Record<string, { score: number; confidence: number; explanation: string }>> = {};
  for (const row of [...(base ?? []), ...(newer ?? [])]) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = {};
    r[t][row.agent_type as string] = { score: Number(row.score), confidence: Number(row.confidence), explanation: (row.explanation as string) ?? '' };
  }
  return r;
}

async function fetchNews(sb: ReturnType<typeof getServiceSupabase>, tickers: string[]) {
  if (!tickers.length) return {};
  const { data } = await sb.from('news_data').select('ticker, headline, source').in('ticker', tickers).order('published_at', { ascending: false }).limit(tickers.length * 3);
  const r: Record<string, { headline: string; source: string }[]> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = [];
    if (r[t].length < 3) r[t].push({ headline: row.headline as string, source: row.source as string });
  }
  return r;
}

async function fetchAssets(sb: ReturnType<typeof getServiceSupabase>) {
  const { data } = await sb.from('assets').select('ticker, name, asset_type');
  const r: Record<string, { name: string; asset_type: string }> = {};
  for (const row of data ?? []) r[row.ticker as string] = { name: row.name as string, asset_type: row.asset_type as string };
  return r;
}

async function fetchFundamentals(sb: ReturnType<typeof getServiceSupabase>) {
  const { data } = await sb.from('fundamental_data').select('ticker, pe_ratio, revenue_growth_yoy, profit_margin, market_cap').order('date', { ascending: false }).limit(2000);
  const r: Record<string, { pe_ratio: number | null; revenue_growth_yoy: number | null; profit_margin: number | null; market_cap: number | null }> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = { pe_ratio: row.pe_ratio != null ? Number(row.pe_ratio) : null, revenue_growth_yoy: row.revenue_growth_yoy != null ? Number(row.revenue_growth_yoy) : null, profit_margin: row.profit_margin != null ? Number(row.profit_margin) : null, market_cap: row.market_cap != null ? Number(row.market_cap) : null };
  }
  return r;
}

async function fetchQuotes(sb: ReturnType<typeof getServiceSupabase>) {
  const { data } = await sb.from('market_quotes').select('ticker, last_price, pct_change').order('date', { ascending: false }).limit(2000);
  const r: Record<string, { last_price: number; pct_change: number }> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = { last_price: Number(row.last_price), pct_change: Number(row.pct_change) };
  }
  return r;
}

async function fetchPrevConclusions(sb: ReturnType<typeof getServiceSupabase>, tickers: string[]) {
  if (!tickers.length) return {};
  const { data } = await sb.from('ticker_conclusions').select('ticker, date, conclusion').in('ticker', tickers).order('date', { ascending: false }).limit(tickers.length);
  const r: Record<string, { date: string; conclusion: string }> = {};
  for (const row of data ?? []) {
    const t = row.ticker as string;
    if (!r[t]) r[t] = { date: row.date as string, conclusion: row.conclusion as string };
  }
  return r;
}
