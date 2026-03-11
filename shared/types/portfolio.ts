import type { AssetType } from './assets.js';

export type RiskProfile = 'conservative' | 'balanced' | 'aggressive';

export type VolatilityTolerance = 'moderate' | 'balanced' | 'tolerant';

export type GoalStatus = 'on_track' | 'monitor' | 'at_risk' | 'off_track';

export type RebalancingPreference = 'daily' | 'weekly' | 'monthly';

export interface UserProfile {
  userId: string;
  investmentCapital: number;       // USD
  timeHorizonMonths: number;
  riskProfile: RiskProfile;
  goalReturnPct: number;           // decimal, e.g. 0.12 for 12%
  maxDrawdownLimitPct: number;     // decimal, e.g. 0.15 for 15%
  volatilityTolerance: VolatilityTolerance;
  assetTypes: AssetType[];         // which asset classes the user allows
  maxPositions: number;
  rebalancingPreference: RebalancingPreference;
  onboardingCompletedAt: string | null;
}

export interface Portfolio {
  id: string;
  userId: string;
  name: string;
  createdAt: string; // ISO 8601 datetime string
  status: 'active' | 'archived';
}

export interface PortfolioPosition {
  id: string;
  portfolioId: string;
  ticker: string;
  quantity: number;
  avgPurchasePrice: number; // USD per unit
  openedAt: string;         // ISO 8601 datetime string
}

export interface PortfolioValuation {
  portfolioId: string;
  date: string;                    // ISO 8601 date string
  totalValue: number;              // USD
  cashValue: number;               // USD (uninvested cash)
  dailyPnl: number;                // USD
  cumulativeReturnPct: number;     // decimal, e.g. 0.08 for 8%
  goalProbabilityPct: number;      // 0–100
}

export interface PortfolioRiskMetrics {
  portfolioId: string;
  date: string;                    // ISO 8601 date string
  volatility: number;              // annualized volatility, decimal
  maxDrawdownPct: number;          // decimal, e.g. 0.12 for 12%
  diversificationScore: number;    // [0.0, 1.0]
  concentrationRisk: number;       // [0.0, 1.0], higher = more concentrated
}
