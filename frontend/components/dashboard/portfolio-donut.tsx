'use client';

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Card } from '@/components/ui/card';
import { formatCurrency } from '@/lib/formatters';
import type { PortfolioPositionWithScore } from '@/lib/queries';

interface PortfolioDonutProps {
  positions: PortfolioPositionWithScore[];
  cashValue: number;
  totalValue: number;
  marketPrices?: Record<string, number>;
}

const COLORS = [
  '#2E6BE6', '#6366F1', '#8B5CF6', '#EC4899', '#F59E0B',
  '#10B981', '#06B6D4', '#EF4444', '#F97316', '#84CC16',
  '#14B8A6', '#A855F7', '#3B82F6', '#E11D48', '#D97706',
];

export function PortfolioDonut({ positions, cashValue, totalValue, marketPrices = {} }: PortfolioDonutProps) {
  // Compute actual total from positions (using market prices) + cash
  let positionsTotal = 0;
  for (const pos of positions) {
    const price = marketPrices[pos.ticker] ?? pos.avgPurchasePrice;
    positionsTotal += pos.quantity * price;
  }
  const effectiveTotal = positionsTotal + Math.max(0, cashValue);

  if (effectiveTotal <= 0 && totalValue <= 0) {
    return (
      <Card>
        <h3 className="text-sm font-medium text-gray-400 mb-3">Allocation</h3>
        <p className="text-gray-500 text-sm text-center py-6">No portfolio data yet.</p>
      </Card>
    );
  }

  const chartTotal = effectiveTotal > 0 ? effectiveTotal : totalValue;
  const data: { name: string; value: number; pct: number }[] = [];

  for (const pos of positions) {
    const price = marketPrices[pos.ticker] ?? pos.avgPurchasePrice;
    const posValue = pos.quantity * price;
    if (posValue > 0) {
      data.push({
        name: pos.ticker,
        value: posValue,
        pct: (posValue / chartTotal) * 100,
      });
    }
  }

  if (cashValue > 0) {
    data.push({
      name: 'Cash',
      value: cashValue,
      pct: (cashValue / chartTotal) * 100,
    });
  }

  if (data.length === 0) {
    data.push({ name: 'Cash', value: chartTotal, pct: 100 });
  }

  return (
    <Card>
      <h3 className="text-sm font-medium text-gray-400 mb-3">Allocation</h3>
      <div className="flex items-center gap-4">
        <div className="w-44 h-44 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#162D4A',
                  border: '1px solid #243F5C',
                  borderRadius: '8px',
                  color: '#F3F4F6',
                  fontSize: '12px',
                }}
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5 overflow-hidden">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center gap-2 text-sm">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
              />
              <span className="text-gray-300 truncate">{d.name}</span>
              <span className="text-gray-500 ml-auto shrink-0">{d.pct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
