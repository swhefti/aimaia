'use client';

import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { ScoreBar } from '@/components/ui/score-bar';
import { Labeled } from '@/components/ui/agent-badge';
import { Sparkline } from '@/components/ui/sparkline';
import { formatCurrency, formatScore } from '@/lib/formatters';
import type { PortfolioPositionWithScore, TickerQuote } from '@/lib/queries';
import type { AgentScore } from '@shared/types/scores';
import { ChevronDown, ChevronRight, Search, Plus, Minus } from 'lucide-react';

interface PositionsTableProps {
  positions: PortfolioPositionWithScore[];
  totalValue: number;
  agentScores: Record<string, AgentScore[]>;
  latestScores: Record<string, number>;
  marketPrices?: Record<string, number>;
  marketQuotes?: Record<string, TickerQuote>;
  cashAvailable?: number;
  onOpenDetail?: (ticker: string, tickerName?: string) => void;
  onAddToPosition?: (ticker: string, quantity: number, pricePerUnit: number) => Promise<void>;
  onReducePosition?: (positionId: string, reduceQty: number, price: number) => Promise<void>;
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

export function PositionsTable({
  positions,
  totalValue,
  agentScores,
  latestScores,
  marketPrices = {},
  marketQuotes = {},
  cashAvailable = 0,
  onOpenDetail,
  onAddToPosition,
  onReducePosition,
}: PositionsTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sparklines, setSparklines] = useState<Map<string, number[]>>(new Map());

  // Inline action state
  const [actionMode, setActionMode] = useState<{ posId: string; mode: 'add' | 'reduce' } | null>(null);
  const [actionAmount, setActionAmount] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

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

  // Reset action mode when expanded position changes
  useEffect(() => {
    setActionMode(null);
    setActionAmount('');
  }, [expanded]);

  if (positions.length === 0) {
    return null;
  }

  function handleActionSubmit(pos: PortfolioPositionWithScore, price: number) {
    if (!actionMode || actionLoading) return;
    const amount = parseFloat(actionAmount);
    if (!amount || amount <= 0) return;

    setActionLoading(true);

    if (actionMode.mode === 'add' && onAddToPosition) {
      const qty = amount / price;
      onAddToPosition(pos.ticker, qty, price)
        .then(() => {
          setActionMode(null);
          setActionAmount('');
        })
        .finally(() => setActionLoading(false));
    } else if (actionMode.mode === 'reduce' && onReducePosition) {
      onReducePosition(pos.id, amount, price)
        .then(() => {
          setActionMode(null);
          setActionAmount('');
        })
        .finally(() => setActionLoading(false));
    } else {
      setActionLoading(false);
    }
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
          const currentAction = actionMode?.posId === pos.id ? actionMode : null;

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

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 mt-2.5">
                    {onOpenDetail && (
                      <button
                        onClick={() => onOpenDetail(pos.ticker, pos.asset?.name)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-navy-700/60 text-xs text-gray-300 hover:bg-navy-600/60 hover:text-white transition-colors"
                      >
                        <Search className="h-3 w-3" /> Details
                      </button>
                    )}
                    {onAddToPosition && (
                      <button
                        onClick={() => {
                          setActionMode(currentAction?.mode === 'add' ? null : { posId: pos.id, mode: 'add' });
                          setActionAmount('');
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                          currentAction?.mode === 'add'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-navy-700/60 text-gray-300 hover:bg-navy-600/60 hover:text-white'
                        }`}
                      >
                        <Plus className="h-3 w-3" /> Add
                      </button>
                    )}
                    {onReducePosition && (
                      <button
                        onClick={() => {
                          setActionMode(currentAction?.mode === 'reduce' ? null : { posId: pos.id, mode: 'reduce' });
                          setActionAmount('');
                        }}
                        className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                          currentAction?.mode === 'reduce'
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-navy-700/60 text-gray-300 hover:bg-navy-600/60 hover:text-white'
                        }`}
                      >
                        <Minus className="h-3 w-3" /> Reduce
                      </button>
                    )}
                  </div>

                  {/* Inline Add form */}
                  {currentAction?.mode === 'add' && (
                    <div className="mt-2 p-2.5 rounded-lg bg-navy-700/40 border border-navy-600/40 space-y-2">
                      <div className="flex items-baseline justify-between text-[10px] text-gray-500">
                        <span>Buy more {pos.ticker} at {formatCurrency(price)}</span>
                        <span>Cash: {formatCurrency(cashAvailable)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs">$</span>
                          <input
                            type="number"
                            value={actionAmount}
                            onChange={(e) => setActionAmount(e.target.value)}
                            placeholder="Amount"
                            min={1}
                            max={cashAvailable}
                            className="w-full pl-5 pr-2 py-1.5 bg-navy-800 border border-navy-500 rounded text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-accent-blue"
                            autoFocus
                          />
                        </div>
                        <button
                          onClick={() => handleActionSubmit(pos, price)}
                          disabled={
                            actionLoading ||
                            !actionAmount ||
                            parseFloat(actionAmount) <= 0 ||
                            parseFloat(actionAmount) > cashAvailable
                          }
                          className="px-3 py-1.5 rounded bg-emerald-600 text-xs text-white font-medium hover:bg-emerald-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {actionLoading ? '...' : 'Buy'}
                        </button>
                      </div>
                      {actionAmount && parseFloat(actionAmount) > 0 && parseFloat(actionAmount) <= cashAvailable && (
                        <p className="text-[10px] text-gray-500">
                          &asymp; {(parseFloat(actionAmount) / price).toFixed(price > 100 ? 4 : 6)} shares
                        </p>
                      )}
                      {actionAmount && parseFloat(actionAmount) > cashAvailable && (
                        <p className="text-[10px] text-red-400">Exceeds available cash</p>
                      )}
                    </div>
                  )}

                  {/* Inline Reduce form */}
                  {currentAction?.mode === 'reduce' && (
                    <div className="mt-2 p-2.5 rounded-lg bg-navy-700/40 border border-navy-600/40 space-y-2">
                      <div className="flex items-baseline justify-between text-[10px] text-gray-500">
                        <span>Sell {pos.ticker} at {formatCurrency(price)}</span>
                        <span>Holdings: {pos.quantity.toFixed(pos.quantity < 10 ? 4 : 2)} shares</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <input
                            type="number"
                            value={actionAmount}
                            onChange={(e) => setActionAmount(e.target.value)}
                            placeholder="Shares to sell"
                            min={0}
                            max={pos.quantity}
                            step="any"
                            className="w-full px-2 py-1.5 bg-navy-800 border border-navy-500 rounded text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-red-500/50"
                            autoFocus
                          />
                        </div>
                        <button
                          onClick={() => setActionAmount(String(pos.quantity))}
                          className="px-2 py-1.5 rounded bg-navy-600 text-[10px] text-gray-300 hover:bg-navy-500 transition-colors"
                        >
                          Sell All
                        </button>
                        <button
                          onClick={() => handleActionSubmit(pos, price)}
                          disabled={
                            actionLoading ||
                            !actionAmount ||
                            parseFloat(actionAmount) <= 0 ||
                            parseFloat(actionAmount) > pos.quantity
                          }
                          className="px-3 py-1.5 rounded bg-red-600 text-xs text-white font-medium hover:bg-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {actionLoading ? '...' : 'Sell'}
                        </button>
                      </div>
                      {actionAmount && parseFloat(actionAmount) > 0 && parseFloat(actionAmount) <= pos.quantity && (
                        <p className="text-[10px] text-gray-500">
                          Proceeds: {formatCurrency(parseFloat(actionAmount) * price)}
                          {parseFloat(actionAmount) === pos.quantity && ' (close position)'}
                        </p>
                      )}
                      {actionAmount && parseFloat(actionAmount) > pos.quantity && (
                        <p className="text-[10px] text-red-400">Exceeds current holdings</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
