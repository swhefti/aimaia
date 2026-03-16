/**
 * Optimizer Types — shared interfaces for the target-weight portfolio optimizer.
 */
import type { AssetType } from '../../shared/types/assets.js';
import type { RiskProfile, VolatilityTolerance } from '../../shared/types/portfolio.js';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface OptimizerUserParams {
  investmentCapital: number;
  timeHorizonMonths: number;
  riskProfile: RiskProfile;
  goalReturnPct: number;         // decimal, e.g. 0.12 for 12%
  maxDrawdownLimitPct: number;   // decimal, e.g. 0.15 for 15%
  volatilityTolerance: VolatilityTolerance;
  assetTypes: AssetType[];
  maxPositions: number;
}

export interface CurrentHolding {
  ticker: string;
  quantity: number;
  avgPurchasePrice: number;
  currentPrice: number;
  currentValue: number;
  weightPct: number; // 0–100
}

export interface TickerScore {
  ticker: string;
  compositeScore: number;     // [-1, 1]
  confidence: number;         // [0, 1]
  dataFreshness: 'current' | 'stale' | 'missing';
  technicalScore: number;
  sentimentScore: number;
  fundamentalScore: number;
  regimeScore: number;
}

export interface OptimizerInput {
  userParams: OptimizerUserParams;
  currentHoldings: CurrentHolding[];
  cashBalance: number;
  totalPortfolioValue: number;
  scores: TickerScore[];
  historicalReturns: Map<string, number[]>; // ticker -> daily log returns
  candidateTickers: string[];               // filtered eligible tickers
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export interface TargetWeight {
  ticker: string;
  weightPct: number; // 0–100
}

export type OptimizerAction = 'BUY' | 'ADD' | 'REDUCE' | 'SELL' | 'HOLD';

export interface PortfolioAction {
  ticker: string;
  action: OptimizerAction;
  currentWeightPct: number;
  targetWeightPct: number;
  deltaWeightPct: number;      // target - current
  confidence: number;
  urgency: 'high' | 'medium' | 'low';
}

export interface OptimizerResult {
  targetWeights: TargetWeight[];
  cashWeightPct: number;
  actions: PortfolioAction[];
  riskMetrics: OptimizerRiskMetrics;
  metadata: {
    solverIterations: number;
    objectiveValue: number;
    candidatesConsidered: number;
    constraintsActive: string[];
  };
}

export interface OptimizerRiskMetrics {
  expectedPortfolioReturn: number;   // annualized decimal
  portfolioVolatility: number;       // annualized decimal
  concentrationRisk: number;         // [0, 1] HHI-based
  diversificationScore: number;      // [0, 1]
  maxDrawdownEstimate: number;       // decimal
  cryptoAllocationPct: number;       // 0–100
}

// ---------------------------------------------------------------------------
// Configuration (risk-profile dependent penalties)
// ---------------------------------------------------------------------------

export interface OptimizerConfig {
  riskPenalty: number;           // lambda for variance penalty
  concentrationPenalty: number;  // lambda for HHI penalty
  turnoverPenalty: number;       // lambda for turnover cost
  rebalanceBandPct: number;     // minimum delta to trigger action (0–100)
  minPositionPct: number;       // minimum meaningful position (0–100)
}
