import Anthropic from '@anthropic-ai/sdk';
import type { SynthesisOutput } from '../../shared/types/synthesis.js';
import { SYNTHESIS_MODEL } from '../../shared/lib/constants.js';
import { createSupabaseClient } from '../../shared/lib/supabase.js';
import { validateSynthesisOutput } from './output-validator.js';

export async function callSynthesisLLM(
  systemPrompt: string,
  userPrompt: string,
  userId: string,
  portfolioId: string,
  runDate: Date
): Promise<{ output: SynthesisOutput; runId: string } | null> {
  const supabase = createSupabaseClient();
  const dateStr = runDate.toISOString().split('T')[0]!;
  const anthropic = new Anthropic();

  // 1. Create synthesis_runs record
  const { data: runRecord, error: runError } = await supabase
    .from('synthesis_runs')
    .insert({
      user_id: userId,
      portfolio_id: portfolioId,
      run_date: dateStr,
      model_used: SYNTHESIS_MODEL,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: 0,
      llm_call_succeeded: false,
      fallback_used: false,
    })
    .select('id')
    .single();

  if (runError || !runRecord) {
    console.error('[LLMCaller] Failed to create synthesis_runs record:', runError?.message);
    return null;
  }

  const runId = runRecord.id as string;
  const startTime = Date.now();

  try {
    // 2. Call Anthropic API
    const response = await anthropic.messages.create({
      model: SYNTHESIS_MODEL,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const latencyMs = Date.now() - startTime;
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;

    // 3. Extract text content
    const rawText = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    // 4. Strip accidental markdown fencing
    const cleaned = rawText.replace(/```json|```/g, '').trim();

    // 5. Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Retry once with format reminder
      console.warn('[LLMCaller] JSON parse failed, retrying with format reminder...');
      const retryResponse = await anthropic.messages.create({
        model: SYNTHESIS_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
          { role: 'assistant', content: cleaned },
          {
            role: 'user',
            content: 'Your response was not valid JSON. Please return ONLY valid JSON matching the schema specified in the system prompt. No preamble, no markdown fencing.',
          },
        ],
      });

      const retryText = retryResponse.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const retryCleaned = retryText.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(retryCleaned);
    }

    // 6. Validate against schema
    const validated = validateSynthesisOutput(parsed);
    if (!validated) {
      console.error('[LLMCaller] Output failed schema validation');
      await updateRunRecord(supabase, runId, {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        latency_ms: latencyMs,
        llm_call_succeeded: false,
        fallback_used: true,
      });
      return null;
    }

    // 7. Update synthesis_runs with success
    await updateRunRecord(supabase, runId, {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: latencyMs,
      llm_call_succeeded: true,
      fallback_used: false,
    });

    // 8. Write raw output to synthesis_raw_outputs
    await supabase.from('synthesis_raw_outputs').insert({
      synthesis_run_id: runId,
      raw_llm_output: parsed,
      post_rules_output: null, // Will be updated after rules engine
      overrides_applied: [],
      low_confidence_reasons: validated.lowConfidenceReasons,
    });

    return { output: validated, runId };
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    console.error('[LLMCaller] LLM call failed:', err);

    await updateRunRecord(supabase, runId, {
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: latencyMs,
      llm_call_succeeded: false,
      fallback_used: true,
    });

    return null;
  }
}

async function updateRunRecord(
  supabase: ReturnType<typeof createSupabaseClient>,
  runId: string,
  data: {
    input_tokens: number;
    output_tokens: number;
    latency_ms: number;
    llm_call_succeeded: boolean;
    fallback_used: boolean;
  }
): Promise<void> {
  const { error } = await supabase.from('synthesis_runs').update(data).eq('id', runId);
  if (error) {
    console.error('[LLMCaller] Failed to update synthesis_runs:', error.message);
  }
}
