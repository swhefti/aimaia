'use client';

import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface SparklineProps {
  data: number[];
  width?: number | undefined;
  height?: number | undefined;
}

export function Sparkline({ data, width = 80, height = 32 }: SparklineProps) {
  if (data.length < 2) {
    return (
      <div style={{ width, height }} className="flex items-center justify-center">
        <span className="text-[10px] text-gray-600">—</span>
      </div>
    );
  }

  const first = data[0]!;
  const last = data[data.length - 1]!;
  const color = last > first ? '#22c55e' : last < first ? '#ef4444' : '#6b7280';

  const chartData = data.map((close, i) => ({ i, close }));

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <Line
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
