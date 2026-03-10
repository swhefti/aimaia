'use client';

import { formatScore } from '@/lib/formatters';
import type { TickerFundamental } from '@/lib/queries';

interface FundamentalBreakdownProps {
  componentScores: Record<string, number> | null;
  fundamentalData: TickerFundamental | null;
  ticker: string;
}

interface FundIndicator {
  key: string;
  label: string;
  scoreKey: string;
  rawValue: string;
  interpretation: string;
  interpColor: string;
  score: number;
  weight: number;
}

const WEIGHTS: { key: string; scoreKey: string; label: string; weight: number }[] = [
  { key: 'pe', scoreKey: 'peScore', label: 'P/E Ratio', weight: 0.25 },
  { key: 'revenue', scoreKey: 'revenueScore', label: 'Revenue Growth', weight: 0.25 },
  { key: 'margin', scoreKey: 'marginScore', label: 'Profit Margin', weight: 0.25 },
  { key: 'roe', scoreKey: 'roeScore', label: 'Return on Equity', weight: 0.15 },
  { key: 'debt', scoreKey: 'debtScore', label: 'Debt/Equity', weight: 0.10 },
];

function getRawValue(key: string, fund: TickerFundamental | null): string {
  if (!fund) return 'No data';
  switch (key) {
    case 'pe':
      return fund.peRatio != null ? `${fund.peRatio.toFixed(1)}×` : 'No data';
    case 'revenue':
      return fund.revenueGrowthYoy != null
        ? `${fund.revenueGrowthYoy >= 0 ? '+' : ''}${(fund.revenueGrowthYoy * 100).toFixed(1)}% YoY`
        : 'No data';
    case 'margin':
      return fund.profitMargin != null ? `${(fund.profitMargin * 100).toFixed(1)}%` : 'No data';
    case 'roe':
      return fund.roe != null ? `${(fund.roe * 100).toFixed(1)}%` : 'No data';
    case 'debt':
      return fund.debtToEquity != null ? fund.debtToEquity.toFixed(2) : 'No data';
    default:
      return 'No data';
  }
}

function getInterpretation(key: string, fund: TickerFundamental | null): { text: string; color: string } {
  const gray = 'text-gray-500';
  if (!fund) return { text: 'Data unavailable', color: gray };

  switch (key) {
    case 'pe': {
      const v = fund.peRatio;
      if (v == null) return { text: 'Data unavailable', color: gray };
      if (v > 30) return { text: 'Premium valuation', color: 'text-red-400' };
      if (v >= 15) return { text: 'Fair valuation', color: 'text-amber-400' };
      return { text: 'Attractive valuation', color: 'text-emerald-400' };
    }
    case 'revenue': {
      const v = fund.revenueGrowthYoy;
      if (v == null) return { text: 'Data unavailable', color: gray };
      if (v > 0.15) return { text: 'Strong growth', color: 'text-emerald-400' };
      if (v >= 0.05) return { text: 'Moderate growth', color: 'text-amber-400' };
      return { text: 'Weak growth', color: 'text-red-400' };
    }
    case 'margin': {
      const v = fund.profitMargin;
      if (v == null) return { text: 'Data unavailable', color: gray };
      if (v > 0.20) return { text: 'High margin', color: 'text-emerald-400' };
      if (v >= 0.10) return { text: 'Healthy margin', color: 'text-amber-400' };
      return { text: 'Thin margin', color: 'text-red-400' };
    }
    case 'roe': {
      const v = fund.roe;
      if (v == null) return { text: 'Data unavailable', color: gray };
      if (v > 0.20) return { text: 'Excellent returns', color: 'text-emerald-400' };
      if (v >= 0.10) return { text: 'Solid returns', color: 'text-amber-400' };
      return { text: 'Weak returns', color: 'text-red-400' };
    }
    case 'debt': {
      const v = fund.debtToEquity;
      if (v == null) return { text: 'Data unavailable', color: gray };
      if (v < 0.5) return { text: 'Low leverage', color: 'text-emerald-400' };
      if (v <= 1.5) return { text: 'Moderate leverage', color: 'text-amber-400' };
      return { text: 'High leverage', color: 'text-red-400' };
    }
    default:
      return { text: '', color: gray };
  }
}

// --- Mini Score Bar (same as technical-breakdown) ---

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

function contributionColor(value: number): string {
  if (value > 0.005) return 'text-emerald-400';
  if (value < -0.005) return 'text-red-400';
  return 'text-gray-500';
}

function formatContribution(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

// --- Market Comparison Bar ---

interface ComparisonBarProps {
  label: string;
  value: number | null;
  marketAvg: number;
  rangeMin: number;
  rangeMax: number;
  formatFn: (v: number) => string;
}

function ComparisonBar({ label, value, marketAvg, rangeMin, rangeMax, formatFn }: ComparisonBarProps) {
  const range = rangeMax - rangeMin;
  const avgPct = ((marketAvg - rangeMin) / range) * 100;
  const valuePct = value != null ? Math.min(100, Math.max(0, ((value - rangeMin) / range) * 100)) : null;

  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] text-gray-500 w-20 shrink-0">{label}</span>
      <div className="flex-1 relative h-3 bg-navy-700 rounded-full">
        {/* Market average diamond */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-2 bg-gray-500 rotate-45"
          style={{ left: `${avgPct}%` }}
          title={`S&P 500 avg: ${formatFn(marketAvg)}`}
        />
        {/* Company value circle */}
        {valuePct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 bg-white rounded-full border border-navy-500"
            style={{ left: `${valuePct}%` }}
            title={formatFn(value!)}
          />
        )}
      </div>
      <div className="text-[10px] text-gray-500 w-16 text-right shrink-0">
        {value != null ? formatFn(value) : '—'}
      </div>
    </div>
  );
}

// --- Main Component ---

export function FundamentalBreakdown({ componentScores, fundamentalData, ticker }: FundamentalBreakdownProps) {
  if (!fundamentalData) {
    return (
      <p className="text-xs text-gray-500 italic">Fundamental data not yet available for this asset</p>
    );
  }

  if (!componentScores || Object.keys(componentScores).length === 0) {
    return (
      <p className="text-xs text-gray-500 italic">Breakdown not available</p>
    );
  }

  const indicators: FundIndicator[] = WEIGHTS.map((meta) => {
    const score = componentScores[meta.scoreKey] ?? 0;
    const interp = getInterpretation(meta.key, fundamentalData);
    return {
      key: meta.key,
      label: meta.label,
      scoreKey: meta.scoreKey,
      rawValue: getRawValue(meta.key, fundamentalData),
      interpretation: interp.text,
      interpColor: interp.color,
      score: meta.key === 'debt' && fundamentalData.debtToEquity == null ? 0 : score,
      weight: meta.weight,
    };
  });

  const totalScore = indicators.reduce((sum, ind) => sum + ind.score * ind.weight, 0);

  const freshnessDate = fundamentalData.date
    ? new Date(fundamentalData.date + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  return (
    <div className="space-y-3">
      {/* Part 1: Sub-indicator Table */}
      <div className="rounded-lg overflow-hidden border border-navy-600/50">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] text-gray-500 uppercase tracking-wider">
              <th className="text-left px-3 py-1.5 font-medium">Metric</th>
              <th className="text-left px-2 py-1.5 font-medium hidden sm:table-cell">Value</th>
              <th className="text-left px-2 py-1.5 font-medium hidden sm:table-cell">Signal</th>
              <th className="text-center px-2 py-1.5 font-medium">Score</th>
              <th className="text-right px-2 py-1.5 font-medium">Weight</th>
              <th className="text-right px-3 py-1.5 font-medium">Contrib.</th>
            </tr>
          </thead>
          <tbody>
            {indicators.map((ind, idx) => {
              const contribution = ind.score * ind.weight;
              const isDebtNull = ind.key === 'debt' && fundamentalData.debtToEquity == null;
              return (
                <tr
                  key={ind.key}
                  className={idx % 2 === 0 ? 'bg-navy-800/50' : 'bg-navy-900/30'}
                >
                  <td className="px-3 py-1.5 text-gray-300 font-medium">{ind.label}</td>
                  <td className="px-2 py-1.5 text-xs text-gray-400 hidden sm:table-cell">
                    {ind.rawValue}
                  </td>
                  <td className={`px-2 py-1.5 text-xs hidden sm:table-cell ${ind.interpColor}`}>
                    {ind.interpretation}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center justify-center gap-1.5">
                      <MiniScoreBar score={isDebtNull ? 0 : ind.score} />
                      <span className={`text-xs font-mono w-10 text-right ${isDebtNull ? 'text-gray-600' : 'text-gray-400'}`}>
                        {isDebtNull ? '—' : formatScore(ind.score)}
                      </span>
                    </div>
                  </td>
                  <td className="px-2 py-1.5 text-xs text-gray-500 text-right">
                    {(ind.weight * 100).toFixed(0)}%
                  </td>
                  <td className={`px-3 py-1.5 text-xs font-mono text-right ${isDebtNull ? 'text-gray-600' : contributionColor(contribution)}`}>
                    {isDebtNull ? '—' : formatContribution(contribution)}
                  </td>
                </tr>
              );
            })}
            {/* Total row */}
            <tr className="border-t border-navy-600/50 bg-navy-700/30">
              <td className="px-3 py-2 text-gray-200 font-semibold" colSpan={3}>
                Total Fundamental Score
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

      {/* Part 2: Market Comparison Bars */}
      <div>
        <h4 className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">vs. Market Average</h4>
        <div className="space-y-2">
          <ComparisonBar
            label="P/E Ratio"
            value={fundamentalData.peRatio}
            marketAvg={22}
            rangeMin={0}
            rangeMax={60}
            formatFn={(v) => `${v.toFixed(1)}×`}
          />
          <ComparisonBar
            label="Profit Margin"
            value={fundamentalData.profitMargin != null ? fundamentalData.profitMargin * 100 : null}
            marketAvg={10}
            rangeMin={0}
            rangeMax={50}
            formatFn={(v) => `${v.toFixed(1)}%`}
          />
          <ComparisonBar
            label="ROE"
            value={fundamentalData.roe != null ? fundamentalData.roe * 100 : null}
            marketAvg={15}
            rangeMin={0}
            rangeMax={60}
            formatFn={(v) => `${v.toFixed(1)}%`}
          />
        </div>
        <p className="text-[10px] text-gray-600 mt-1.5 flex items-center gap-2">
          <span className="inline-block w-2 h-2 bg-gray-500 rotate-45 shrink-0" /> S&amp;P 500 avg
          <span className="inline-block w-2 h-2 bg-white rounded-full border border-navy-500 shrink-0" /> {ticker}
        </p>
      </div>

      {/* Part 3: Data freshness note */}
      {freshnessDate && (
        <p className="text-xs text-gray-500">
          Fundamental data as of {freshnessDate}. Updates with quarterly earnings.
        </p>
      )}
    </div>
  );
}
