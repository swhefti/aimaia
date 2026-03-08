import { Card } from '@/components/ui/card';
import { ConfidenceBadge } from '@/components/ui/badge';
import { LabeledBlock, Labeled } from '@/components/ui/agent-badge';
import { goalStatusToColor, goalStatusToLabel, confidenceToLabel } from '@/lib/formatters';
import type { GoalStatus } from '@shared/types/portfolio';

interface DailyBriefingProps {
  narrative: string;
  goalProbabilityPct: number;
  goalStatus: GoalStatus;
  overallConfidence: number;
  actionCount: number;
  runDate: string;
}

export function DailyBriefing({
  narrative,
  goalProbabilityPct,
  goalStatus,
  overallConfidence,
  actionCount,
  runDate,
}: DailyBriefingProps) {
  const date = new Date(runDate);
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric' });

  return (
    <Card className="border-accent-blue/30 bg-gradient-to-br from-navy-800 to-navy-900">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Today&apos;s Briefing</h2>
          <span className="text-sm text-gray-400">{dateStr}</span>
        </div>
        <LabeledBlock agent="synthesis">
          <p className="text-sm text-gray-300 leading-relaxed">{narrative}</p>
        </LabeledBlock>
        <div className="flex items-center gap-6 text-sm flex-wrap">
          <div>
            <span className="text-gray-400">Goal probability: </span>
            <Labeled agent="synthesis">
              <span className={`font-semibold ${goalStatusToColor(goalStatus)}`}>
                {Math.round(goalProbabilityPct)}%
              </span>
            </Labeled>
          </div>
          <ConfidenceBadge confidence={overallConfidence} agent="synthesis" />
          {actionCount > 0 && (
            <Labeled agent="recommendation">
              <span className="text-gray-400">
                {actionCount} action{actionCount !== 1 ? 's' : ''} recommended today
              </span>
            </Labeled>
          )}
        </div>
      </div>
    </Card>
  );
}
