import Anthropic from '@anthropic-ai/sdk';
import { createSupabaseClient } from '../../../shared/lib/supabase.js';
import { FinnhubClient, type NewsResponse } from '../providers/finnhub.js';
import type { AssetType } from '../../../shared/types/assets.js';
import type { IngestionResult } from './price-ingestion.js';

interface ExtractedMacroEvent {
  event_description: string;
  event_type: string;
  relevant_asset_types: AssetType[];
  relevant_tickers: string[];
  sentiment: number;
  source_url: string | null;
}

const SYSTEM_PROMPT = `You are a financial news analyst. Given a list of recent market news headlines and summaries, identify the most significant macro events that would meaningfully affect investment decisions.

For each event, extract:
- event_description: A concise description of the event
- event_type: One of 'fed_decision', 'earnings', 'geopolitical', 'economic_data', 'other'
- relevant_asset_types: Array of affected asset types from ['stock', 'etf', 'crypto']
- relevant_tickers: Array of specific affected tickers (empty array if broad market impact)
- sentiment: Number from -1.0 (extremely bearish) to +1.0 (extremely bullish)
- source_url: The URL of the primary source article, or null

Return a JSON array of macro events. Only include events that would meaningfully affect investment decisions. Typical output: 0-5 events per day. If no significant events, return an empty array.

IMPORTANT: Return ONLY the JSON array, no other text.`;

export async function runMacroEventsIngestion(): Promise<IngestionResult> {
  const supabase = createSupabaseClient();
  const result: IngestionResult = { success: 0, failed: 0, errors: [] };

  // Fetch market news from the last 24h
  let newsItems: NewsResponse[];
  try {
    const finnhub = new FinnhubClient();
    const allNews = await finnhub.getMarketNews();
    const oneDayAgo = Date.now() / 1000 - 24 * 60 * 60;
    newsItems = allNews.filter((n) => n.datetime >= oneDayAgo && n.headline.trim().length > 0);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.failed++;
    result.errors.push(`Failed to fetch market news: ${msg}`);
    console.error(`[MacroEvents] News fetch error: ${msg}`);
    return result;
  }

  if (newsItems.length === 0) {
    console.log('[MacroEvents] No recent news to analyze');
    return result;
  }

  // Format news for LLM
  const newsText = newsItems
    .slice(0, 50) // Limit to top 50 to stay within context
    .map((n) => `- [${n.source}] ${n.headline}\n  ${n.summary}\n  URL: ${n.url}`)
    .join('\n\n');

  // Call Claude to classify macro events
  try {
    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Analyze the following news from the last 24 hours and extract significant macro events:\n\n${newsText}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      result.failed++;
      result.errors.push('No text response from LLM');
      return result;
    }

    let events: ExtractedMacroEvent[];
    try {
      events = JSON.parse(textBlock.text) as ExtractedMacroEvent[];
    } catch {
      result.failed++;
      result.errors.push(`Failed to parse LLM response as JSON: ${textBlock.text.slice(0, 200)}`);
      return result;
    }

    if (!Array.isArray(events)) {
      result.failed++;
      result.errors.push('LLM response is not an array');
      return result;
    }

    const today = new Date().toISOString().split('T')[0]!;

    for (const event of events) {
      // Validate sentiment range
      const sentiment = Math.max(-1, Math.min(1, event.sentiment));

      const { error } = await supabase.from('macro_events').insert({
        date: today,
        event_description: event.event_description,
        event_type: event.event_type,
        relevant_asset_types: event.relevant_asset_types,
        relevant_tickers: event.relevant_tickers,
        sentiment,
        source_url: event.source_url,
      });

      if (error) {
        result.failed++;
        result.errors.push(`macro_events insert: ${error.message}`);
      } else {
        result.success++;
      }
    }

    console.log(`[MacroEvents] Extracted ${events.length} macro events`);
  } catch (err: unknown) {
    result.failed++;
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`LLM call failed: ${msg}`);
    console.error(`[MacroEvents] LLM error: ${msg}`);
  }

  return result;
}
