'use client';

import { Card } from '@/components/ui/card';
import { formatCurrency, formatPct } from '@/lib/formatters';
import type { PortfolioValuation } from '@shared/types/portfolio';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface PortfolioOverviewProps {
  valuations: PortfolioValuation[];
  cashValue: number;
  totalValue: number;
  investedValue: number;
}

export function PortfolioOverview({
  valuations,
  cashValue,
  totalValue,
  investedValue,
}: PortfolioOverviewProps) {
  const latest = valuations[valuations.length - 1];

  if (!latest && totalValue <= 0) {
    return (
      <Card>
        <div className="text-center py-12">
          <p className="text-gray-400">No valuation data yet. Add positions to start tracking performance.</p>
        </div>
      </Card>
    );
  }

  const returnPct = latest?.cumulativeReturnPct ?? 0;
  const dailyPnl = latest?.dailyPnl ?? 0;
  const isPositive = returnPct >= 0;
  const isDailyPositive = dailyPnl >= 0;
  const strokeColor = isPositive ? '#10B981' : '#EF4444';
  const gradientId = 'portfolioGradient';

  const chartData = valuations.map((v) => ({
    date: new Date(v.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    value: v.totalValue,
  }));

  // Calculate total return in dollars
  const firstVal = valuations[0];
  const latestTotal = latest?.totalValue ?? totalValue;
  const returnDollars = firstVal ? latestTotal - firstVal.totalValue : 0;

  return (
    <Card padding="sm" className="overflow-hidden">
      <div className="space-y-2">
        {/* Value header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Portfolio Value</p>
            <p className="text-2xl font-bold text-white tracking-tight">
              {formatCurrency(totalValue)}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`flex items-center gap-1 text-xs font-medium ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : returnPct < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                {formatPct(returnPct)} ({isPositive ? '+' : ''}{formatCurrency(returnDollars)})
              </span>
              <span className="text-gray-600">|</span>
              <span className={`text-xs ${isDailyPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {isDailyPositive ? '+' : ''}{formatCurrency(dailyPnl)} today
              </span>
            </div>
          </div>
          <div className="flex gap-5 text-xs">
            <div>
              <p className="text-gray-500">Invested</p>
              <p className="text-white font-medium">{formatCurrency(investedValue)}</p>
            </div>
            <div>
              <p className="text-gray-500">Cash</p>
              <p className="text-white font-medium">{formatCurrency(cashValue)}</p>
            </div>
          </div>
        </div>

        {/* Chart */}
        {chartData.length > 1 && latest ? (
          <div className="h-40 -mx-3 -mb-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={strokeColor} stopOpacity={0.25} />
                    <stop offset="100%" stopColor={strokeColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E3A5F" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) =>
                    v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`
                  }
                  domain={['auto', 'auto']}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#162D4A',
                    border: '1px solid #243F5C',
                    borderRadius: '8px',
                    color: '#F3F4F6',
                  }}
                  formatter={(value: number) => [formatCurrency(value), 'Value']}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={strokeColor}
                  strokeWidth={2}
                  fill={`url(#${gradientId})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-20 flex items-center justify-center">
            <p className="text-xs text-gray-500">Chart will appear after the second day of data.</p>
          </div>
        )}
      </div>
    </Card>
  );
}
