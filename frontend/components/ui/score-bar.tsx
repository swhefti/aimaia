'use client';

import { formatScore } from '@/lib/formatters';
import { Labeled, type AgentType } from '@/components/ui/agent-badge';

interface ScoreBarProps {
  score: number;
  label?: string;
  confidence?: number;
  agent?: AgentType;
}

export function ScoreBar({ score, label, confidence, agent }: ScoreBarProps) {
  // Convert score from [-1, 1] to percentage [0, 100] for positioning
  const pct = ((score + 1) / 2) * 100;
  const barColor =
    score >= 0.2 ? 'bg-emerald-400' : score >= -0.19 ? 'bg-gray-400' : 'bg-red-400';

  // Infer agent type from label if not provided
  const agentType: AgentType = agent ??
    (label?.toLowerCase().includes('technical') ? 'technical'
    : label?.toLowerCase().includes('sentiment') ? 'sentiment'
    : label?.toLowerCase().includes('fundamental') ? 'fundamental'
    : label?.toLowerCase().includes('regime') ? 'market_regime'
    : 'composite');

  return (
    <div className="flex items-center gap-3">
      {label && <span className="text-xs text-gray-400 w-28 shrink-0 capitalize">{label}</span>}
      <div className="flex-1 relative h-2 bg-navy-700 rounded-full overflow-hidden">
        {/* Center line */}
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-navy-500" />
        {/* Score bar */}
        <div
          className={`absolute top-0 bottom-0 ${barColor} rounded-full`}
          style={{
            left: score >= 0 ? '50%' : `${pct}%`,
            width: `${Math.abs(score) * 50}%`,
          }}
        />
      </div>
      <Labeled agent={agentType}>
        <span className="text-xs font-mono text-gray-300 w-12 text-right">{formatScore(score)}</span>
      </Labeled>
      {confidence !== undefined && (
        <span className="text-xs text-gray-500 w-8 text-right">
          {confidence >= 0.7 ? 'H' : confidence >= 0.4 ? 'M' : 'L'}
        </span>
      )}
    </div>
  );
}
