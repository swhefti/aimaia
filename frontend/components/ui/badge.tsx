'use client';

import { scoreToColorBg, urgencyToColor, confidenceToLabel } from '@/lib/formatters';
import { scoreToSignal } from '@shared/lib/constants';
import { Labeled, type AgentType } from '@/components/ui/agent-badge';

interface SignalBadgeProps {
  score: number;
  agent?: AgentType;
}

export function SignalBadge({ score, agent = 'composite' }: SignalBadgeProps) {
  return (
    <Labeled agent={agent}>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${scoreToColorBg(score)}`}>
        {scoreToSignal(score)}
      </span>
    </Labeled>
  );
}

interface ConfidenceBadgeProps {
  confidence: number;
  agent?: AgentType;
}

export function ConfidenceBadge({ confidence, agent = 'synthesis' }: ConfidenceBadgeProps) {
  const label = confidenceToLabel(confidence);
  const color =
    label === 'High'
      ? 'bg-emerald-500/20 text-emerald-400'
      : label === 'Medium'
        ? 'bg-amber-500/20 text-amber-400'
        : 'bg-gray-500/20 text-gray-400';

  return (
    <Labeled agent={agent}>
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
        {label} confidence
      </span>
    </Labeled>
  );
}

interface UrgencyBadgeProps {
  urgency: string;
}

export function UrgencyBadge({ urgency }: UrgencyBadgeProps) {
  const label = urgency === 'high' ? 'Today' : urgency === 'medium' ? 'This Week' : 'Consider';
  return (
    <Labeled agent="recommendation">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${urgencyToColor(urgency)}`}>
        {label}
      </span>
    </Labeled>
  );
}

interface AssetTypeBadgeProps {
  type: string;
}

export function AssetTypeBadge({ type }: AssetTypeBadgeProps) {
  const color =
    type === 'stock'
      ? 'bg-blue-500/20 text-blue-400'
      : type === 'etf'
        ? 'bg-purple-500/20 text-purple-400'
        : 'bg-orange-500/20 text-orange-400';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium uppercase ${color}`}>
      {type}
    </span>
  );
}
