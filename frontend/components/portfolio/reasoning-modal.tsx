'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { ScoreBar } from '@/components/ui/score-bar';
import { ConfidenceBadge } from '@/components/ui/badge';
import { Labeled, LabeledBlock } from '@/components/ui/agent-badge';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/components/auth-provider';
import { getRecommendationItems, getAgentScoresForTicker, getSynthesisRawOutput } from '@/lib/queries';
import { confidenceToLabel } from '@/lib/formatters';
import type { RecommendationItem } from '@shared/types/recommendations';
import type { AgentScore } from '@shared/types/scores';

interface ReasoningModalProps {
  open: boolean;
  onClose: () => void;
  recommendationId: string | null;
  synthesisRunId?: string | undefined;
}

interface ParsedWeightRationale {
  technical: number;
  sentiment: number;
  fundamental: number;
  regime: number;
  reasoning: string;
}

export function ReasoningModal({ open, onClose, recommendationId, synthesisRunId }: ReasoningModalProps) {
  const { supabase } = useAuth();
  const [item, setItem] = useState<RecommendationItem | null>(null);
  const [scores, setScores] = useState<AgentScore[]>([]);
  const [weights, setWeights] = useState<ParsedWeightRationale | null>(null);
  const [contextNotes, setContextNotes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !recommendationId) return;
    setLoading(true);

    async function load() {
      try {
        // Get the recommendation item (fetch all from run and find ours)
        const { data: recData } = await supabase
          .from('recommendation_items')
          .select('*')
          .eq('id', recommendationId)
          .single();

        if (!recData) return;
        const mappedItem: RecommendationItem = {
          id: recData.id,
          runId: recData.run_id,
          ticker: recData.ticker,
          action: recData.action,
          urgency: recData.urgency,
          currentAllocationPct: recData.current_allocation_pct,
          targetAllocationPct: recData.target_allocation_pct,
          llmReasoning: recData.llm_reasoning,
          confidence: recData.confidence,
          rulesEngineApplied: recData.rules_engine_applied,
          rulesEngineNote: recData.rules_engine_note,
          priority: recData.priority,
        };
        setItem(mappedItem);

        // Get agent scores for this ticker
        const agentScores = await getAgentScoresForTicker(supabase, recData.ticker);
        setScores(agentScores);

        // Get synthesis raw output for weight rationale and context
        if (synthesisRunId) {
          const raw = await getSynthesisRawOutput(supabase, synthesisRunId);
          if (raw) {
            const output = raw.rawLlmOutput as Record<string, unknown>;
            if (output?.weightRationale) setWeights(output.weightRationale as typeof weights);
            if (raw.lowConfidenceReasons?.length) setContextNotes(raw.lowConfidenceReasons);
          }
        }

        // Also get weight rationale from the recommendation run
        const { data: runData } = await supabase
          .from('recommendation_runs')
          .select('weight_rationale')
          .eq('id', recData.run_id)
          .single();
        if (runData?.weight_rationale && !weights) {
          setWeights(runData.weight_rationale);
        }
      } catch (err) {
        console.error('Error loading reasoning data:', err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [open, recommendationId, synthesisRunId, supabase]);

  const findScore = (type: string) => scores.find((s) => s.agentType === type);

  return (
    <Modal open={open} onClose={onClose} title={item ? `${item.action} ${item.ticker}` : 'Loading...'}>
      {loading ? (
        <div className="py-12">
          <Spinner message="Loading analysis details..." />
        </div>
      ) : !item ? (
        <p className="text-gray-400">Could not load recommendation details.</p>
      ) : (
        <div className="space-y-6">
          {/* Header summary */}
          <div className="flex items-center gap-3 flex-wrap">
            <Labeled agent="recommendation">
              <span className={`text-lg font-semibold ${
                item.action === 'BUY' || item.action === 'ADD' ? 'text-emerald-400' :
                item.action === 'SELL' || item.action === 'REDUCE' ? 'text-red-400' :
                'text-gray-300'
              }`}>
                {item.action} {item.ticker}
              </span>
            </Labeled>
            <Labeled agent="recommendation">
              <span className="text-sm text-gray-400">
                {item.currentAllocationPct.toFixed(1)}% → {item.targetAllocationPct.toFixed(1)}% allocation
              </span>
            </Labeled>
            <ConfidenceBadge confidence={item.confidence} agent="recommendation" />
          </div>

          {/* Why section */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
              Why the System Recommends This
            </h3>
            <LabeledBlock agent="synthesis">
              <p className="text-sm text-gray-300 leading-relaxed">{item.llmReasoning}</p>
            </LabeledBlock>
            {item.rulesEngineNote && (
              <LabeledBlock agent="recommendation">
                <p className="text-xs text-amber-400 mt-2">Rules Engine: {item.rulesEngineNote}</p>
              </LabeledBlock>
            )}
          </div>

          {/* Evidence: Agent Scores */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Evidence</h3>
            <div className="space-y-2">
              {(['technical', 'sentiment', 'fundamental', 'market_regime'] as const).map((type) => {
                const s = findScore(type);
                const label = type === 'market_regime' ? 'Regime' : type.charAt(0).toUpperCase() + type.slice(1);
                if (!s) {
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 w-24 shrink-0">{label}</span>
                      <span className="text-xs text-gray-500">N/A</span>
                    </div>
                  );
                }
                return (
                  <ScoreBar
                    key={type}
                    score={s.score}
                    label={label}
                    confidence={s.confidence}
                  />
                );
              })}
            </div>
          </div>

          {/* Weight Adjustment */}
          {weights && (
            <LabeledBlock agent="synthesis">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Weight Adjustment Today
              </h3>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="text-gray-400">Technical: {(weights.technical * 100).toFixed(0)}%</div>
                <div className="text-gray-400">Sentiment: {(weights.sentiment * 100).toFixed(0)}%</div>
                <div className="text-gray-400">Fundamental: {(weights.fundamental * 100).toFixed(0)}%</div>
                <div className="text-gray-400">Regime: {(weights.regime * 100).toFixed(0)}%</div>
              </div>
              {weights.reasoning && (
                <p className="text-xs text-gray-500 mt-2">{weights.reasoning}</p>
              )}
            </LabeledBlock>
          )}

          {/* Context Considered */}
          {contextNotes.length > 0 && (
            <LabeledBlock agent="synthesis">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Context Considered
              </h3>
              <ul className="space-y-1">
                {contextNotes.map((note, i) => (
                  <li key={i} className="text-sm text-gray-400 flex gap-2">
                    <span className="text-gray-600">&#x2022;</span>
                    {note}
                  </li>
                ))}
              </ul>
            </LabeledBlock>
          )}

          {/* Component scores detail */}
          {scores.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Component Scores Detail
              </h3>
              {scores.map((s) => {
                const entries = Object.entries(s.componentScores);
                if (entries.length === 0) return null;
                return (
                  <div key={s.agentType} className="mb-3">
                    <span className="text-xs text-gray-400 font-medium capitalize">{s.agentType.replace('_', ' ')}</span>
                    <div className="mt-1 space-y-1">
                      {entries.map(([key, val]) => (
                        <ScoreBar key={key} score={val} label={key} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
