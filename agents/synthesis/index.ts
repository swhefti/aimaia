/**
 * Synthesis Agent — now operates in explanation-only mode.
 *
 * Architecture (post-optimizer refactor):
 * - The optimizer (backend/optimizer/) determines target weights and actions
 * - The synthesis agent explains those actions using LLM
 * - The rules engine is retained as a final safety net
 *
 * For daily production runs, use: npx tsx backend/jobs/synthesis.ts
 * This module provides the library interface for the agents/ pipeline.
 */
import type { SynthesisOutput } from '../../shared/types/synthesis.js';
import type { AgentScore } from '../../shared/types/scores.js';
import { createSupabaseClient } from '../../shared/lib/supabase.js';
import { buildContextPackage } from './context-builder.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt-builder.js';
import { callSynthesisLLM } from './llm-caller.js';
import { applyRulesEngine, generateFallbackRecommendations } from './rules-engine.js';
import type { PortfolioState, RulesOverride } from './rules-engine.js';
import { formatNarrative } from './narrative-formatter.js';

/**
 * Run synthesis for a portfolio. This is the agents/ library version.
 * The production job (backend/jobs/synthesis.ts) uses an optimizer-first flow.
 * This function retains the original LLM-based flow as a fallback/reference.
 */
export async function runSynthesisForPortfolio(
  portfolioId: string,
  userId: string,
  date: Date
): Promise<void> {
  const supabase = createSupabaseClient();
  const dateStr = date.toISOString().split('T')[0]!;

  console.log(`[Synthesis] Starting for portfolio ${portfolioId}, user ${userId}`);

  try {
    const context = await buildContextPackage(userId, portfolioId, date);
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(context);
    const llmResult = await callSynthesisLLM(systemPrompt, userPrompt, userId, portfolioId, date);

    const { data: profileData } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (!profileData) {
      throw new Error(`No user profile found for ${userId}`);
    }

    const userProfile = {
      userId: profileData.user_id as string,
      investmentCapital: Number(profileData.investment_capital),
      timeHorizonMonths: Number(profileData.time_horizon_months),
      riskProfile: profileData.risk_profile as 'conservative' | 'balanced' | 'aggressive',
      goalReturnPct: Number(profileData.goal_return_pct),
      maxDrawdownLimitPct: Number(profileData.max_drawdown_limit_pct),
      volatilityTolerance: profileData.volatility_tolerance as 'moderate' | 'balanced' | 'tolerant',
      assetTypes: profileData.asset_types as ('stock' | 'etf' | 'crypto')[],
      maxPositions: Number(profileData.max_positions),
      rebalancingPreference: (profileData.rebalancing_preference as 'daily' | 'weekly' | 'monthly') ?? 'daily',
      onboardingCompletedAt: (profileData.onboarding_completed_at as string) ?? null,
    };

    const portfolioState: PortfolioState = {
      positions: context.portfolioState.positions.map((p) => ({
        ticker: p.ticker,
        allocationPct: p.currentAllocationPct,
        unrealizedPnlPct: p.unrealizedPnlPct,
      })),
      cashPct: context.portfolioState.cashAllocationPct,
      totalValue: context.portfolioState.totalValueUsd,
    };

    let finalOutput: SynthesisOutput;
    let overrides: RulesOverride[] = [];
    let runId: string;

    if (llmResult) {
      const rulesResult = await applyRulesEngine(llmResult.output, userProfile, portfolioState);
      finalOutput = rulesResult.validated;
      overrides = rulesResult.overrides;
      runId = llmResult.runId;
    } else {
      console.warn(`[Synthesis] LLM call failed for portfolio ${portfolioId}. Using fallback.`);
      const { data: agentScoresData } = await supabase
        .from('agent_scores').select('*').eq('date', dateStr);

      const agentScores: AgentScore[] = (agentScoresData ?? []).map((s) => ({
        ticker: s.ticker as string, date: s.date as string,
        agentType: s.agent_type as AgentScore['agentType'],
        score: Number(s.score), confidence: Number(s.confidence),
        componentScores: (s.component_scores as Record<string, number>) ?? {},
        explanation: (s.explanation as string) ?? '',
        dataFreshness: (s.data_freshness as AgentScore['dataFreshness']) ?? 'missing',
        agentVersion: (s.agent_version as string) ?? '1.0.0',
      }));

      finalOutput = generateFallbackRecommendations(agentScores, userProfile, portfolioState);

      const { data: fallbackRun } = await supabase.from('synthesis_runs').insert({
        user_id: userId, portfolio_id: portfolioId, run_date: dateStr,
        model_used: 'fallback', input_tokens: 0, output_tokens: 0,
        latency_ms: 0, llm_call_succeeded: false, fallback_used: true,
      }).select('id').single();

      runId = (fallbackRun?.id as string) ?? 'unknown';
    }

    finalOutput.portfolioNarrative = formatNarrative(finalOutput);

    if (llmResult) {
      await supabase.from('synthesis_raw_outputs')
        .update({ post_rules_output: finalOutput, overrides_applied: overrides })
        .eq('synthesis_run_id', runId);
    }

    const { data: recRun, error: recRunError } = await supabase
      .from('recommendation_runs').insert({
        portfolio_id: portfolioId, run_date: dateStr, synthesis_run_id: runId,
        overall_confidence: finalOutput.overallConfidence,
        goal_status: finalOutput.portfolioAssessment.goalStatus,
        portfolio_narrative: finalOutput.portfolioNarrative,
        weight_rationale: finalOutput.weightRationale,
        fallback_used: !llmResult,
      }).select('id').single();

    if (recRunError || !recRun) {
      console.error('[Synthesis] Failed to write recommendation_runs:', recRunError?.message);
      return;
    }

    const recRunId = recRun.id as string;
    const { data: validAssets } = await supabase.from('assets').select('ticker');
    const validTickers = new Set((validAssets ?? []).map((a) => a.ticker as string));

    const validRecs = finalOutput.recommendations.filter((rec) => validTickers.has(rec.ticker));

    for (let i = 0; i < validRecs.length; i++) {
      const rec = validRecs[i]!;
      const currentPos = portfolioState.positions.find((p) => p.ticker === rec.ticker);
      const override = overrides.find((o) => o.ticker === rec.ticker);

      await supabase.from('recommendation_items').insert({
        run_id: recRunId, ticker: rec.ticker, action: rec.action, urgency: rec.urgency,
        current_allocation_pct: currentPos?.allocationPct ?? 0,
        target_allocation_pct: rec.targetAllocationPct,
        llm_reasoning: rec.reasoning, confidence: rec.confidence,
        rules_engine_applied: !!override,
        rules_engine_note: override ? `${override.rule}: ${override.reason}` : null,
        priority: i + 1,
      });
    }

    console.log(`[Synthesis] Complete for portfolio ${portfolioId}. ${validRecs.length} recommendations, ${overrides.length} overrides.`);
  } catch (err) {
    console.error(`[Synthesis] Error for portfolio ${portfolioId}:`, err);
  }
}
