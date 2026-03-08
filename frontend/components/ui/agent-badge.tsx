'use client';

import type { ReactNode } from 'react';
import { useAgentLabels } from '@/components/agent-label-provider';

export type AgentType =
  | 'technical'
  | 'sentiment'
  | 'fundamental'
  | 'market_regime'
  | 'synthesis'
  | 'recommendation'
  | 'composite';

const LABEL: Record<AgentType, string> = {
  technical: 'TECH',
  sentiment: 'SENT',
  fundamental: 'FUND',
  market_regime: 'REGM',
  synthesis: 'SYNTH',
  recommendation: 'REC',
  composite: 'COMP',
};

const COLOR: Record<AgentType, string> = {
  technical: 'bg-blue-500/25 text-blue-300',
  sentiment: 'bg-purple-500/25 text-purple-300',
  fundamental: 'bg-teal-500/25 text-teal-300',
  market_regime: 'bg-amber-500/25 text-amber-300',
  synthesis: 'bg-indigo-500/25 text-indigo-300',
  recommendation: 'bg-rose-500/25 text-rose-300',
  composite: 'bg-slate-500/25 text-slate-300',
};

interface LabeledProps {
  agent: AgentType;
  children: ReactNode;
  className?: string;
}

/**
 * Wraps agent-produced content. When "Label Agent Work" is on, shows a tiny
 * absolutely-positioned badge indicating the source agent. The badge is outside
 * normal flow so toggling causes zero layout shift.
 */
export function Labeled({ agent, children, className }: LabeledProps) {
  const { showLabels } = useAgentLabels();

  return (
    <span className={`relative${className ? ` ${className}` : ''}`}>
      {children}
      {showLabels && (
        <span
          className={`absolute -top-2 -right-1 translate-x-full text-[7px] leading-none font-bold px-[3px] py-[1px] rounded pointer-events-none select-none whitespace-nowrap z-20 ${COLOR[agent]}`}
        >
          {LABEL[agent]}
        </span>
      )}
    </span>
  );
}

/**
 * Block-level variant for wrapping larger sections (narratives, paragraphs).
 * Uses a div instead of span.
 */
export function LabeledBlock({ agent, children, className }: LabeledProps) {
  const { showLabels } = useAgentLabels();

  return (
    <div className={`relative${className ? ` ${className}` : ''}`}>
      {children}
      {showLabels && (
        <span
          className={`absolute -top-2 right-0 text-[7px] leading-none font-bold px-[3px] py-[1px] rounded pointer-events-none select-none whitespace-nowrap z-20 ${COLOR[agent]}`}
        >
          {LABEL[agent]}
        </span>
      )}
    </div>
  );
}
