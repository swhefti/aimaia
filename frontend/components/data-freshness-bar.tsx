'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { useSimulation } from '@/components/simulation-provider';
import { getMarketFreshness, type MarketFreshness } from '@/lib/queries';
import { Clock } from 'lucide-react';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function hoursAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

export function DataFreshnessBar() {
  const { supabase } = useAuth();
  const { isSimulation, simulationDate } = useSimulation();
  const [freshness, setFreshness] = useState<MarketFreshness | null>(null);

  useEffect(() => {
    const asOfDate = isSimulation ? simulationDate ?? undefined : undefined;
    getMarketFreshness(supabase, asOfDate)
      .then(setFreshness)
      .catch(() => {});
  }, [supabase, isSimulation, simulationDate]);

  if (!freshness || (!freshness.stocksUpdatedAt && !freshness.cryptoUpdatedAt)) {
    return null;
  }

  const stockStale = freshness.stocksUpdatedAt ? hoursAgo(freshness.stocksUpdatedAt) > 25 : true;
  const cryptoStale = freshness.cryptoUpdatedAt ? hoursAgo(freshness.cryptoUpdatedAt) > 5 : true;

  return (
    <div className="flex items-center gap-4 text-xs">
      <Clock className="h-3 w-3 text-gray-500 shrink-0" />
      {freshness.stocksUpdatedAt && (
        <span className={stockStale ? 'text-amber-400' : 'text-gray-500'}>
          Stocks/ETFs: {formatTimestamp(freshness.stocksUpdatedAt)}
        </span>
      )}
      {freshness.cryptoUpdatedAt && (
        <span className={cryptoStale ? 'text-amber-400' : 'text-gray-500'}>
          Crypto: {formatTimestamp(freshness.cryptoUpdatedAt)}
        </span>
      )}
    </div>
  );
}
