'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { calculateBollingerBands } from '@/lib/indicators';
import { formatScore } from '@/lib/formatters';
import type { PriceRow } from '@/components/ui/price-chart';

interface TechnicalBreakdownProps {
  componentScores: Record<string, number> | null;
  explanation: string | null;
  priceHistory: PriceRow[];
}

interface SubIndicator {
  key: string;
  label: string;
  configKey: string;
  score: number;
  weight: number;
  interpretation: string;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  subweight_technical_macd: 0.3,
  subweight_technical_ema: 0.25,
  subweight_technical_rsi: 0.2,
  subweight_technical_bollinger: 0.15,
  subweight_technical_volume: 0.1,
};

const INDICATOR_META: { key: string; scoreKey: string; label: string; configKey: string }[] = [
  { key: 'macd', scoreKey: 'macdScore', label: 'MACD', configKey: 'subweight_technical_macd' },
  { key: 'ema', scoreKey: 'emaScore', label: 'EMA Alignment', configKey: 'subweight_technical_ema' },
  { key: 'rsi', scoreKey: 'rsiScore', label: 'RSI', configKey: 'subweight_technical_rsi' },
  { key: 'bollinger', scoreKey: 'bollingerScore', label: 'Bollinger', configKey: 'subweight_technical_bollinger' },
  { key: 'volume', scoreKey: 'volumeScore', label: 'Volume', configKey: 'subweight_technical_volume' },
];

function parseRsiValue(explanation: string): number | null {
  const m = explanation.match(/RSI\s*=\s*([\d.]+)/i);
  return m ? parseFloat(m[1]!) : null;
}

function parseMacdHist(explanation: string): number | null {
  const m = explanation.match(/MACD\s*hist\s*=\s*([+-]?[\d.]+)/i);
  return m ? parseFloat(m[1]!) : null;
}

function parseEmaValue(explanation: string): number | null {
  const m = explanation.match(/EMA\s*=\s*([+-]?[\d.]+)/i);
  return m ? parseFloat(m[1]!) : null;
}

function getInterpretation(key: string, score: number, explanation: string): string {
  switch (key) {
    case 'macd': {
      return score > 0 ? 'Bullish crossover' : score < 0 ? 'Bearish crossover' : 'Neutral';
    }
    case 'ema': {
      if (score >= 0.5) return 'Price above all EMAs';
      if (score <= -0.5) return 'Price below EMAs';
      return 'Mixed EMA alignment';
    }
    case 'rsi': {
      const rsi = parseRsiValue(explanation);
      if (rsi !== null) {
        if (rsi > 70) return `Overbought (${rsi.toFixed(0)})`;
        if (rsi < 30) return `Oversold (${rsi.toFixed(0)})`;
        return `Neutral (${rsi.toFixed(0)})`;
      }
      if (score <= -0.5) return 'Overbought (>70)';
      if (score >= 0.5) return 'Oversold (<30)';
      return 'Neutral';
    }
    case 'bollinger': {
      if (score <= -0.3) return 'Near upper band';
      if (score >= 0.3) return 'Near lower band';
      return 'Mid-range';
    }
    case 'volume': {
      return score > 0.2 ? 'High volume confirms move' : 'Low/neutral volume';
    }
    default:
      return '';
  }
}

function interpretationColor(key: string, score: number): string {
  if (key === 'rsi') {
    if (score <= -0.5) return 'text-red-400';
    if (score >= 0.5) return 'text-emerald-400';
    return 'text-gray-400';
  }
  if (score > 0.15) return 'text-emerald-400';
  if (score < -0.15) return 'text-red-400';
  return 'text-gray-400';
}

function contributionColor(value: number): string {
  if (value > 0.005) return 'text-emerald-400';
  if (value < -0.005) return 'text-red-400';
  return 'text-gray-500';
}

function formatContribution(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
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

// --- Bollinger Band Chart ---

function BollingerChart({ data }: { data: PriceRow[] }) {
  const closes = data.map((d) => d.close);
  const bb = useMemo(() => calculateBollingerBands(closes, 20, 2), [closes]);

  const chartData = useMemo(() =>
    data.map((d, i) => ({
      date: d.date,
      close: d.close,
      ema20: Number.isNaN(bb.middle[i]!) ? undefined : bb.middle[i],
      upper: Number.isNaN(bb.upper[i]!) ? undefined : bb.upper[i],
      lower: Number.isNaN(bb.lower[i]!) ? undefined : bb.lower[i],
      band: Number.isNaN(bb.upper[i]!) ? undefined : [bb.lower[i], bb.upper[i]],
    })),
    [data, bb],
  );

  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const validUpper = bb.upper.filter((v) => !Number.isNaN(v));
  const validLower = bb.lower.filter((v) => !Number.isNaN(v));
  const bbMax = validUpper.length > 0 ? Math.max(...validUpper) : max;
  const bbMin = validLower.length > 0 ? Math.min(...validLower) : min;
  const overallMin = Math.min(min, bbMin);
  const overallMax = Math.max(max, bbMax);
  const padding = (overallMax - overallMin) * 0.08 || overallMax * 0.02;
  const yDomain: [number, number] = [Math.max(0, overallMin - padding), overallMax + padding];
  const tickInterval = Math.max(1, Math.floor(data.length / 6));

  return (
    <div>
      <ResponsiveContainer width="100%" height={160}>
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
            formatter={(value: number, name: string) => {
              const label = name === 'close' ? 'Price'
                : name === 'ema20' ? 'EMA 20'
                : name === 'upper' ? 'Upper BB'
                : name === 'lower' ? 'Lower BB'
                : name;
              return [formatPrice(value), label];
            }}
          />
          {/* Bollinger Band shaded area */}
          <Area
            type="monotone"
            dataKey="upper"
            stroke="rgba(59, 130, 246, 0.3)"
            strokeWidth={1}
            fill="rgba(59, 130, 246, 0.08)"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          <Area
            type="monotone"
            dataKey="lower"
            stroke="rgba(59, 130, 246, 0.3)"
            strokeWidth={1}
            fill="#0b1120"
            dot={false}
            isAnimationActive={false}
            connectNulls={false}
          />
          {/* EMA20 line */}
          <Line
            type="monotone"
            dataKey="ema20"
            stroke="#3B82F6"
            strokeWidth={1.5}
            dot={false}
            strokeDasharray="4 2"
            connectNulls={false}
            isAnimationActive={false}
          />
          {/* Close price line */}
          <Line
            type="monotone"
            dataKey="close"
            stroke="#ffffff"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-gray-500 text-center mt-1">
        EMA 20 with Bollinger Bands (&plusmn;2&sigma;, 20-day)
      </p>
    </div>
  );
}

// --- Mini Score Bar ---

function MiniScoreBar({ score }: { score: number }) {
  const pct = ((score + 1) / 2) * 100;
  const barColor =
    score >= 0.2 ? 'bg-emerald-400' : score >= -0.19 ? 'bg-gray-400' : 'bg-red-400';

  return (
    <div className="relative h-1.5 w-16 bg-navy-700 rounded-full overflow-hidden">
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-navy-500" />
      <div
        className={`absolute top-0 bottom-0 ${barColor} rounded-full`}
        style={{
          left: score >= 0 ? '50%' : `${pct}%`,
          width: `${Math.abs(score) * 50}%`,
        }}
      />
    </div>
  );
}

// --- Main Component ---

export function TechnicalBreakdown({ componentScores, explanation, priceHistory }: TechnicalBreakdownProps) {
  const [weights, setWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS);

  useEffect(() => {
    fetch('/api/ticker/technical-weights')
      .then((res) => res.json())
      .then((data: { weights?: Record<string, number> }) => {
        if (data.weights) setWeights(data.weights);
      })
      .catch(() => {});
  }, []);

  if (!componentScores || Object.keys(componentScores).length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">Breakdown not available</p>
    );
  }

  const indicators: SubIndicator[] = INDICATOR_META.map((meta) => {
    const score = componentScores[meta.scoreKey] ?? 0;
    const weight = weights[meta.configKey] ?? DEFAULT_WEIGHTS[meta.configKey]!;
    return {
      key: meta.key,
      label: meta.label,
      configKey: meta.configKey,
      score,
      weight,
      interpretation: getInterpretation(meta.key, score, explanation ?? ''),
    };
  });

  const totalScore = indicators.reduce((sum, ind) => sum + ind.score * ind.weight, 0);

  return (
    <div className="space-y-3">
      {/* Bollinger Band Chart */}
      {priceHistory.length >= 5 && <BollingerChart data={priceHistory} />}

      {/* Sub-indicator Table */}
      <div className="rounded-lg overflow-hidden border border-navy-600/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
              <th className="text-left px-3 py-1.5 font-medium">Indicator</th>
              <th className="text-left px-2 py-1.5 font-medium hidden sm:table-cell">Signal</th>
              <th className="text-center px-2 py-1.5 font-medium">Score</th>
              <th className="text-right px-2 py-1.5 font-medium">Weight</th>
              <th className="text-right px-3 py-1.5 font-medium">Contrib.</th>
            </tr>
          </thead>
          <tbody>
            {indicators.map((ind, idx) => {
              const contribution = ind.score * ind.weight;
              return (
                <tr
                  key={ind.key}
                  className={idx % 2 === 0 ? 'bg-navy-800/50' : 'bg-navy-900/30'}
                >
                  <td className="px-3 py-1.5 text-gray-300 font-medium">{ind.label}</td>
                  <td className={`px-2 py-1.5 text-xs hidden sm:table-cell ${interpretationColor(ind.key, ind.score)}`}>
                    {ind.interpretation}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <MiniScoreBar score={ind.score} />
                      <span className="text-xs font-mono text-gray-400 w-10 text-right">
                        {formatScore(ind.score)}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-500 text-right">
                    {(ind.weight * 100).toFixed(0)}%
                  </td>
                  <td className={`px-3 py-1.5 text-xs font-mono text-right ${contributionColor(contribution)}`}>
                    {formatContribution(contribution)}
                  </td>
                </tr>
              );
            })}
            {/* Total row */}
            <tr className="border-t border-navy-600/50 bg-navy-700/30">
              <td className="px-3 py-2 text-gray-200 font-semibold" colSpan={2}>
                Total Technical Score
              </td>
              <td className="px-2 py-2">
                <div className="flex items-center justify-center gap-1.5">
                  <MiniScoreBar score={totalScore} />
                  <span className="text-xs font-mono font-bold text-gray-200 w-10 text-right">
                    {formatScore(totalScore)}
                  </span>
                </div>
              </td>
              <td className="px-2 py-2 text-xs text-gray-400 text-right">100%</td>
              <td className={`px-3 py-2 text-xs font-mono font-bold text-right ${contributionColor(totalScore)}`}>
                {formatContribution(totalScore)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
