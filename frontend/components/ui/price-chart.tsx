'use client';

import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { calculateEMA } from '@/lib/indicators';

export interface PriceRow {
  date: string;
  close: number;
}

interface PriceChartProps {
  data: PriceRow[];
  dateRange?: { from: string | null; to: string | null } | undefined;
  loading?: boolean | undefined;
}

function formatPrice(value: number): string {
  if (value >= 1000) return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatRangeDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function PriceChart({ data, dateRange, loading }: PriceChartProps) {
  if (loading) {
    return (
      <div className="h-[180px] bg-navy-700/30 rounded-lg animate-pulse" />
    );
  }

  if (data.length < 5) {
    return (
      <div className="h-[180px] bg-navy-700/30 rounded-lg flex items-center justify-center">
        <p className="text-xs text-gray-500">Not enough price history yet</p>
      </div>
    );
  }

  const ema20 = useMemo(() => calculateEMA(data.map((d) => d.close), 20), [data]);

  const chartData = useMemo(() =>
    data.map((d, i) => ({
      date: d.date,
      close: d.close,
      ema20: Number.isNaN(ema20[i]!) ? undefined : ema20[i],
    })),
    [data, ema20],
  );

  // Compute Y domain with padding
  const closes = data.map((d) => d.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const padding = (max - min) * 0.08 || max * 0.02;
  const yDomain: [number, number] = [Math.max(0, min - padding), max + padding];

  // Compute tick interval for X axis (5-7 labels max)
  const tickInterval = Math.max(1, Math.floor(data.length / 6));

  const rangeFrom = dateRange?.from ?? data[0]?.date;
  const rangeTo = dateRange?.to ?? data[data.length - 1]?.date;

  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e2a3a" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDateLabel}
            interval={tickInterval}
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            axisLine={{ stroke: '#1e2a3a' }}
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            tickFormatter={formatPrice}
            tick={{ fill: '#9ca3af', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={55}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#131825',
              border: '1px solid #1e2a3a',
              borderRadius: '8px',
              fontSize: '12px',
            }}
            labelFormatter={formatDateLabel}
            formatter={(value: number, name: string) => [
              formatPrice(value),
              name === 'close' ? 'Price' : 'EMA 20',
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }}
            formatter={(value: string) => (value === 'close' ? 'Price' : 'EMA 20')}
          />
          <Line
            type="monotone"
            dataKey="close"
            stroke="#ffffff"
            strokeWidth={1.5}
            dot={false}
            name="close"
          />
          <Line
            type="monotone"
            dataKey="ema20"
            stroke="#3B82F6"
            strokeWidth={1.5}
            dot={false}
            strokeDasharray="4 2"
            name="ema20"
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {rangeFrom && rangeTo && (
        <p className="text-[10px] text-gray-500 text-center mt-1">
          {formatRangeDate(rangeFrom)} – {formatRangeDate(rangeTo)} ({data.length} trading day{data.length !== 1 ? 's' : ''})
        </p>
      )}
    </div>
  );
}
