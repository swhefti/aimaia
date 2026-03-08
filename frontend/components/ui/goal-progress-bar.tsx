'use client';

import type { GoalStatus } from '@shared/types/portfolio';
import { goalStatusToLabel } from '@/lib/formatters';
import { Labeled } from '@/components/ui/agent-badge';

interface GoalProgressBarProps {
  probabilityPct: number;
  status: GoalStatus;
  previousPct?: number | undefined;
}

export function GoalProgressBar({ probabilityPct, status, previousPct }: GoalProgressBarProps) {
  const statusColor: Record<GoalStatus, string> = {
    on_track: 'bg-emerald-500',
    monitor: 'bg-amber-500',
    at_risk: 'bg-orange-500',
    off_track: 'bg-red-500',
  };

  const statusTextColor: Record<GoalStatus, string> = {
    on_track: 'text-emerald-400',
    monitor: 'text-amber-400',
    at_risk: 'text-orange-400',
    off_track: 'text-red-400',
  };

  const trend = previousPct !== undefined
    ? probabilityPct > previousPct ? 'up' : probabilityPct < previousPct ? 'down' : 'flat'
    : 'flat';
  const trendArrow = trend === 'up' ? '\u25B2' : trend === 'down' ? '\u25BC' : '';

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-2">
        <Labeled agent="synthesis">
          <span className="text-4xl font-bold text-white">
            {probabilityPct % 1 === 0 ? Math.round(probabilityPct) : probabilityPct.toFixed(1)}%
          </span>
        </Labeled>
        <span className="text-sm text-gray-400">probability</span>
        <Labeled agent="synthesis">
          <span className={`text-sm font-medium ${statusTextColor[status]}`}>
            {goalStatusToLabel(status)} {trendArrow}
            {previousPct !== undefined && ` from ${previousPct % 1 === 0 ? Math.round(previousPct) : previousPct.toFixed(1)}%`}
          </span>
        </Labeled>
      </div>
      <div className="w-full h-3 bg-navy-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${statusColor[status]}`}
          style={{ width: `${Math.min(100, Math.max(0, probabilityPct))}%` }}
        />
      </div>
    </div>
  );
}
