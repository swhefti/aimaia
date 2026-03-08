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
}

export function GoalTracker({
  goalReturnPct,
  timeHorizonMonths,
  probabilityPct,
  previousPct,
  goalStatus,
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
      </div>
    </Card>
  );
}
