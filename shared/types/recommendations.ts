import type { GoalStatus } from './portfolio.js';
import type { RecommendationAction, RecommendationUrgency } from './synthesis.js';

export interface RecommendationRun {
  id: string;
  portfolioId: string;
  runDate: string;          // ISO 8601 date string
  synthesisRunId: string;
  overallConfidence: number; // [0.0, 1.0]
  goalStatus: GoalStatus;
  portfolioNarrative: string;
  weightRationale: {
    technical: number;
    sentiment: number;
    fundamental: number;
    regime: number;
    reasoning: string;
  };
  generatedAt: string; // ISO 8601 datetime string
}

export interface RecommendationItem {
  id: string;
  runId: string;
  ticker: string;
  action: RecommendationAction;
  urgency: RecommendationUrgency;
  currentAllocationPct: number; // 0–100
  targetAllocationPct: number;  // 0–100
  llmReasoning: string;
  confidence: number;            // [0.0, 1.0]
  rulesEngineApplied: boolean;
  rulesEngineNote: string | null;
  priority: number;              // sort order, lower = higher priority
}

export type UserDecisionValue = 'approved' | 'dismissed' | 'deferred';

export interface UserDecision {
  id: string;
  recommendationId: string;
  decision: UserDecisionValue;
  decidedAt: string; // ISO 8601 datetime string
  userNote: string | null;
}
