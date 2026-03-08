'use client';

import { useEffect, useState } from 'react';

interface CompositeScoreGaugeProps {
  score: number; // -1.0 to +1.0
}

function getZoneLabel(score: number): string {
  if (score >= 0.6) return 'STRONG BUY';
  if (score >= 0.2) return 'BUY';
  if (score > -0.2) return 'NEUTRAL';
  if (score > -0.6) return 'SELL';
  return 'STRONG SELL';
}

function getZoneColor(score: number): string {
  if (score >= 0.6) return '#22c55e';
  if (score >= 0.2) return '#84cc16';
  if (score > -0.2) return '#eab308';
  if (score > -0.6) return '#f97316';
  return '#ef4444';
}

export function CompositeScoreGauge({ score }: CompositeScoreGaugeProps) {
  const [animatedAngle, setAnimatedAngle] = useState(Math.PI);

  const targetAngle = Math.PI * (1 - (score + 1) / 2);

  useEffect(() => {
    setAnimatedAngle(Math.PI);
    const timer = setTimeout(() => setAnimatedAngle(targetAngle), 50);
    return () => clearTimeout(timer);
  }, [targetAngle]);

  const cx = 120;
  const cy = 110;
  const r = 90;
  const strokeWidth = 16;

  const zones = [
    { startFrac: 0, endFrac: 0.2, color: '#ef4444' },
    { startFrac: 0.2, endFrac: 0.4, color: '#f97316' },
    { startFrac: 0.4, endFrac: 0.6, color: '#eab308' },
    { startFrac: 0.6, endFrac: 0.8, color: '#84cc16' },
    { startFrac: 0.8, endFrac: 1.0, color: '#22c55e' },
  ];

  function arcPath(startAngle: number, endAngle: number): string {
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy - r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy - r * Math.sin(endAngle);
    const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
    // sweep=1 so arcs curve upward (clockwise in SVG coords)
    return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`;
  }

  const needleLen = r - 8;
  const nx = cx + needleLen * Math.cos(animatedAngle);
  const ny = cy - needleLen * Math.sin(animatedAngle);

  const zoneLabel = getZoneLabel(score);
  const zoneColor = getZoneColor(score);

  return (
    <div className="flex flex-col items-center">
      <svg width="140" height="85" viewBox="0 0 240 140" className="overflow-visible">
        {/* Arc zones */}
        {zones.map((zone, i) => {
          const startAngle = Math.PI * (1 - zone.startFrac);
          const endAngle = Math.PI * (1 - zone.endFrac);
          return (
            <path
              key={i}
              d={arcPath(startAngle, endAngle)}
              fill="none"
              stroke={zone.color}
              strokeWidth={strokeWidth}
              strokeLinecap="butt"
              opacity={0.5}
            />
          );
        })}

        {/* Tick marks at zone boundaries */}
        {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((frac, i) => {
          const angle = Math.PI * (1 - frac);
          const innerR = r - strokeWidth / 2 - 2;
          const outerR = r + strokeWidth / 2 + 2;
          const x1t = cx + innerR * Math.cos(angle);
          const y1t = cy - innerR * Math.sin(angle);
          const x2t = cx + outerR * Math.cos(angle);
          const y2t = cy - outerR * Math.sin(angle);
          return (
            <line
              key={i}
              x1={x1t} y1={y1t} x2={x2t} y2={y2t}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1}
            />
          );
        })}

        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="white"
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ transition: 'all 0.8s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        />

        {/* Center pivot */}
        <circle cx={cx} cy={cy} r={5} fill="#374151" stroke="white" strokeWidth={2} />
      </svg>

      {/* Score value and zone label */}
      <div className="flex flex-col items-center -mt-1">
        <span className="text-lg font-bold font-mono text-white">
          {score >= 0 ? '+' : ''}{score.toFixed(2)}
        </span>
        <span
          className="text-xs font-semibold tracking-wider"
          style={{ color: zoneColor }}
        >
          {zoneLabel}
        </span>
      </div>
    </div>
  );
}
