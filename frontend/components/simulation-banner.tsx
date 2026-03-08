'use client';

import { useSimulation } from '@/components/simulation-provider';
import { ChevronRight, Loader2 } from 'lucide-react';

export function SimulationBanner() {
  const { isSimulation, simulationDate, advanceDay, isAdvancing } = useSimulation();

  if (!isSimulation || !simulationDate) return null;

  const today = new Date().toISOString().split('T')[0]!;
  const canAdvance = simulationDate < today && !isAdvancing;

  const displayDate = new Date(simulationDate + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  // Count how many days we've advanced (from start date which is today - 30)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);
  const startStr = startDate.toISOString().split('T')[0]!;
  const dayNum = Math.round(
    (new Date(simulationDate + 'T12:00:00').getTime() - new Date(startStr + 'T12:00:00').getTime()) / (1000 * 60 * 60 * 24)
  ) + 1;

  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-amber-400 bg-amber-500/20 px-2 py-0.5 rounded">
          SIMULATION
        </span>
        <span className="text-sm text-amber-300">
          Day {dayNum} — <span className="font-medium text-white">{displayDate}</span>
        </span>
        {isAdvancing && (
          <span className="flex items-center gap-1.5 text-xs text-amber-400/80">
            <Loader2 className="h-3 w-3 animate-spin" />
            Fetching market data...
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {simulationDate >= today && (
          <span className="text-xs text-amber-400/60">Caught up to today</span>
        )}
        <button
          onClick={advanceDay}
          disabled={!canAdvance}
          className={`flex items-center gap-1 text-sm font-medium px-3 py-1 rounded-lg transition-colors ${
            canAdvance
              ? 'text-amber-300 hover:text-white bg-amber-500/20 hover:bg-amber-500/30'
              : 'text-amber-500/40 bg-amber-500/10 cursor-not-allowed'
          }`}
        >
          {isAdvancing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Simulating...
            </>
          ) : (
            <>
              Next Day <ChevronRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
