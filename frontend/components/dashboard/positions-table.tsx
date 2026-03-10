'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { ScoreBar } from '@/components/ui/score-bar';
import { Labeled } from '@/components/ui/agent-badge';
import { Sparkline } from '@/components/ui/sparkline';
import { formatCurrency, formatScore } from '@/lib/formatters';
import type { PortfolioPositionWithScore, TickerQuote } from '@/lib/queries';
import type { AgentScore } from '@shared/types/scores';
import { ChevronDown, ChevronRight } from 'lucide-react';

interface PositionsTableProps {
  positions: PortfolioPositionWithScore[];
  totalValue: number;
  agentScores: Record<string, AgentScore[]>;
  latestScores: Record<string, number>;
  marketPrices?: Record<string, number>;
  marketQuotes?: Record<string, TickerQuote>;
}

function scoreBg(score: number): string {
  if (score >= 0.6) return 'bg-emerald-500/20 text-emerald-400 ring-emerald-500/30';
  if (score >= 0.2) return 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20';
  if (score <= -0.6) return 'bg-red-500/20 text-red-400 ring-red-500/30';
  if (score <= -0.2) return 'bg-red-500/10 text-red-400 ring-red-500/20';
  return 'bg-gray-500/10 text-gray-400 ring-gray-500/20';
}

function changeColor(pct: number): string {
  if (pct > 0) return 'text-emerald-400';
  if (pct < 0) return 'text-red-400';
  return 'text-gray-500';
}

export function PositionsTable({ positions, totalValue, agentScores, latestScores, marketPrices = {}, marketQuotes = {} }: PositionsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sparklines, setSparklines] = useState<Map<string, number[]>>(new Map());

  useEffect(() => {
    if (positions.length === 0) return;
    const tickers = positions.map((p) => p.ticker);
    Promise.all(
      tickers.map(async (ticker) => {
        try {
          const res = await fetch(`/api/ticker/price-history?ticker=${encodeURIComponent(ticker)}&days=10`);
          if (!res.ok) return [ticker, [] as number[]] as [string, number[]];
          const json = await res.json();
          const closes: number[] = (json.rows ?? []).map((r: { close: number }) => r.close).slice(-7);
          return [ticker, closes] as [string, number[]];
        } catch {
          return [ticker, []] as [string, number[]];
        }
      }),
    ).then((results) => {
      const map = new Map<string, number[]>();
      for (const [ticker, closes] of results) {
        map.set(ticker, closes);
      }
      setSparklines(map);
    });
  }, [positions]);

  if (positions.length === 0) {
    return null;
  }

  return (
    <Card padding="sm">
      <h3 className="text-sm font-medium text-gray-400 px-2.5 pb-2">Positions</h3>
      <div className="divide-y divide-navy-600/50">
        {positions.map((pos) => {
          const quote = marketQuotes[pos.ticker];
          const price = quote?.lastPrice ?? marketPrices[pos.ticker] ?? pos.avgPurchasePrice;
          const pctChange = quote?.pctChange ?? 0;
          const posValue = pos.quantity * price;
          const allocationPct = totalValue > 0 ? (posValue / totalValue) * 100 : 0;
          const compositeScore = latestScores[pos.ticker];
          const isExpanded = expanded === pos.id;
          const scores = agentScores[pos.ticker] || [];

          return (
            <div key={pos.id}>
              <button
                onClick={() => setExpanded(isExpanded ? null : pos.id)}
                className="w-full px-2.5 py-2 flex items-center gap-2 hover:bg-navy-700/50 transition-colors text-left"
              >
                <span className="text-gray-500 shrink-0">
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </span>

                {/* Name + ticker */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-white truncate block leading-tight">
                    {pos.asset?.name || pos.ticker}
                  </span>
                  <span className="text-[10px] text-gray-500 block leading-tight">{pos.ticker}</span>
                </div>

                {/* 7d Trend sparkline */}
                <div className="shrink-0">
                  <Sparkline data={sparklines.get(pos.ticker) ?? []} />
                </div>

                {/* Shares */}
                <div className="text-right shrink-0 w-12">
                  <div className="text-[10px] text-gray-500">Shares</div>
                  <div className="text-xs text-gray-300">{pos.quantity < 10 ? pos.quantity.toFixed(2) : pos.quantity.toFixed(0)}</div>
                </div>

                {/* Price + 24h change */}
                <div className="text-right shrink-0 w-16">
                  <div className="text-xs text-gray-300">{formatCurrency(price)}</div>
                  <div className={`text-[10px] font-medium ${changeColor(pctChange)}`}>
                    {pctChange >= 0 ? '+' : ''}{(pctChange * 100).toFixed(2)}%
                  </div>
                </div>

                {/* Value + allocation */}
                <div className="text-right shrink-0 w-16">
                  <div className="text-xs text-gray-300">{formatCurrency(posValue)}</div>
                  <div className="text-[10px] text-gray-500">{allocationPct.toFixed(1)}%</div>
                </div>

                {/* Composite score pill */}
                {compositeScore !== undefined && (
                  <Labeled agent="composite">
                    <div className={`shrink-0 px-2 py-1 rounded-md ring-1 text-center ${scoreBg(compositeScore)}`}>
                      <div className="text-[9px] leading-none opacity-70 mb-0.5">Score</div>
                      <div className="text-xs font-bold font-mono leading-none">
                        {formatScore(compositeScore)}
                      </div>
                    </div>
                  </Labeled>
                )}
              </button>

              {isExpanded && (
                <div className="px-2.5 pb-2.5 pt-0.5">
                  {/* Title area */}
                  <div className="mb-2">
                    <h3 className="text-sm font-semibold text-white">
                      {pos.asset?.name || pos.ticker}
                    </h3>
                    <span className="text-[10px] text-gray-500">{pos.ticker}</span>
                  </div>

                  {/* Agent scores */}
                  {scores.length > 0 && (
                    <div className="space-y-1.5 mb-2">
                      {scores.map((s) => {
                        const label = s.agentType === 'technical' ? 'Technical Score'
                          : s.agentType === 'sentiment' ? 'Sentiment Score'
                          : s.agentType === 'fundamental' ? 'Fundamental Score'
                          : s.agentType === 'market_regime' ? 'Regime Score'
                          : `${s.agentType} Score`;
                        return (
                          <ScoreBar
                            key={s.agentType}
                            score={s.score}
                            label={label}
                            confidence={s.confidence}
                          />
                        );
                      })}
                    </div>
                  )}

                  {/* Position details */}
                  <div className="flex items-center gap-3 text-[10px] text-gray-500 border-t border-navy-600/50 pt-1.5">
                    <span>Qty: {pos.quantity.toFixed(2)}</span>
                    <span>Avg: {formatCurrency(pos.avgPurchasePrice)}</span>
                    <span>Price: {formatCurrency(price)}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
