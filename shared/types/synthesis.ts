import type { AssetType } from './assets.js';
import type { GoalStatus, RiskProfile, VolatilityTolerance } from './portfolio.js';

export type MarketRegimeLabel = 'bullish' | 'neutral' | 'cautious' | 'bearish';

export type RecommendationAction = 'BUY' | 'SELL' | 'REDUCE' | 'ADD' | 'HOLD';

export type RecommendationUrgency = 'high' | 'medium' | 'low';

// ---------------------------------------------------------------------------
// Sub-types used inside SynthesisContextPackage
// ---------------------------------------------------------------------------

export interface PortfolioPositionContext {
  ticker: string;
  currentAllocationPct: number; // 0–100
  currentValue: number;         // USD
  unrealizedPnlPct: number;     // decimal
}

export interface AssetScoreContext {
  ticker: string;
  technicalScore: number;
  sentimentScore: number;
  fundamentalScore: number;
  regimeScore: number;
  technicalConfidence: number;
  sentimentConfidence: number;
  fundamentalConfidence: number;
  regimeConfidence: number;
  dataFreshness: 'current' | 'stale' | 'missing';
}

export interface MacroEventContext {
  date: string;
  eventDescription: string;
  eventType: string;
  sentiment: number; // [-1.0, +1.0]
  relevantAssetTypes: AssetType[];
}

// ---------------------------------------------------------------------------
// Input to the LLM Synthesis Agent
// ---------------------------------------------------------------------------

export interface SynthesisContextPackage {
  userContext: {
    goalReturnPct: number;
    timeHorizonMonths: number;
    riskProfile: RiskProfile;
    maxDrawdownLimitPct: number;
    volatilityTolerance: VolatilityTolerance;
    assetTypePreference: AssetType[];
    maxPositions: number;
  };
  portfolioState: {
    totalValueUsd: number;
    goalProbabilityPct: number;
    goalProbabilityTrend: 'improving' | 'stable' | 'declining';
    cashAllocationPct: number;
    concentrationRisk: number; // [0.0, 1.0]
    positions: PortfolioPositionContext[];
  };
  assetScores: AssetScoreContext[];
  marketRegime: {
    regimeLabel: MarketRegimeLabel;
    volatilityLevel: 'low' | 'moderate' | 'high' | 'extreme';
    broadTrend: 'uptrend' | 'sideways' | 'downtrend';
    sectorRotation: string; // descriptive, e.g. "rotating into defensive sectors"
    regimeConfidence: number; // [0.0, 1.0]
  };
  macroEvents: MacroEventContext[];
}

// ---------------------------------------------------------------------------
// Output from the LLM Synthesis Agent
// ---------------------------------------------------------------------------

export interface SynthesisRecommendation {
  ticker: string;
  action: RecommendationAction;
  urgency: RecommendationUrgency;
  targetAllocationPct: number; // 0–100
  reasoning: string;
  confidence: number; // [0.0, 1.0]
}

export interface SynthesisOutput {
  weightRationale: {
    technical: number;   // [0.0, 1.0], weights must sum to 1.0
    sentiment: number;
    fundamental: number;
    regime: number;
    reasoning: string;
  };
  portfolioAssessment: {
    goalStatus: GoalStatus;
    primaryRisk: string;
    assessment: string;
  };
  recommendations: SynthesisRecommendation[];
  portfolioNarrative: string; // plain-language daily briefing, ≤3 paragraphs
  overallConfidence: number;  // [0.0, 1.0]
  lowConfidenceReasons: string[];
}
