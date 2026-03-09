'use client';

import { Card } from '@/components/ui/card';
import { GoalProgressBar } from '@/components/ui/goal-progress-bar';
import type { GoalStatus } from '@shared/types/portfolio';
import { formatPct } from '@/lib/formatters';

interface GoalTrackerProps {
  goalReturnPct: number;
  timeHorizonMonths: number;
  probabilityPct: number;
  previousPct?: number | undefined;
  goalStatus: GoalStatus;
  aiOpusPct?: number | null | undefined;
  aiSonnetPct?: number | null | undefined;
  aiLoading?: boolean | undefined;
}

export function GoalTracker({
  goalReturnPct,
  timeHorizonMonths,
  probabilityPct,
  previousPct,
  goalStatus,
  aiOpusPct,
  aiSonnetPct,
  aiLoading,
}: GoalTrackerProps) {
  return (
    <Card padding="sm">
      <div className="space-y-3">
        <h3 className="text-xs font-medium text-gray-400">
          Goal: {formatPct(goalReturnPct)} return in {timeHorizonMonths} month{timeHorizonMonths !== 1 ? 's' : ''}
        </h3>
        <GoalProgressBar
          probabilityPct={probabilityPct}
          status={goalStatus}
          previousPct={previousPct}
        />
        <div className="flex gap-4 pt-1">
          <AiIndicator label="Opus" pct={aiOpusPct} loading={aiLoading} />
          <AiIndicator label="Sonnet" pct={aiSonnetPct} loading={aiLoading} />
        </div>
      </div>
    </Card>
  );
}

function AiIndicator({ label, pct, loading }: { label: string; pct?: number | null | undefined; loading?: boolean | undefined }) {
  // Show pulsing only if loading AND this specific indicator hasn't arrived yet
  const isPending = loading && pct == null;
  const color = pct == null ? 'text-gray-500'
    : pct >= 60 ? 'text-emerald-400'
    : pct >= 40 ? 'text-amber-400'
    : 'text-red-400';

  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">{label}</span>
      {isPending ? (
        <span className="text-lg font-semibold text-gray-500 animate-pulse">--</span>
      ) : pct != null ? (
        <span className={`text-lg font-semibold ${color}`}>
          {pct % 1 === 0 ? Math.round(pct) : pct.toFixed(1)}%
        </span>
      ) : (
        <span className="text-lg font-semibold text-gray-600">--</span>
      )}
    </div>
  );
}
