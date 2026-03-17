/**
 * Shared Optimizer Core v2 — covariance-aware portfolio optimization.
 *
 * Used by:
 *   1. frontend/app/api/optimizer/build/route.ts  (onboarding)
 *   2. backend/jobs/synthesis.ts                   (daily management)
 *   3. backend/jobs/evaluate-optimizer.ts          (backtesting)
 *
 * v2 improvements over v1:
 *   - Real covariance/correlation from historical returns with shrinkage fallback
 *   - Iterative objective-based allocation (not just score-proportional)
 *   - Theme/cluster concentration controls
 *   - Trade-friction-aware rebalancing with minimum trade thresholds
 *   - Richer portfolio risk metrics
 *
 * This module MUST NOT import from backend/ or frontend/.
 */
import { ASSET_TYPE_MAP, MAX_POSITION_PCT, MAX_CRYPTO_ALLOCATION_PCT, CASH_FLOOR_PCT, MAX_DAILY_CHANGES } from './constants.js';
import type { AssetType } from '../types/assets.js';
import type { RiskProfile, VolatilityTolerance } from '../types/portfolio.js';

// ===========================================================================
// Types
// ===========================================================================

export interface OptimizerTickerScore {
  ticker: string;
  compositeScore: number;     // [-1, 1]
  confidence: number;         // [0, 1]
  dataFreshness: 'current' | 'stale' | 'missing';
}

export interface OptimizerCurrentHolding {
  ticker: string;
  quantity: number;
  avgPurchasePrice: number;
  currentPrice: number;
  currentValue: number;
  weightPct: number; // 0–100
}

export interface OptimizerUserParams {
  maxPositions: number;
  assetTypes: AssetType[];
  riskProfile: RiskProfile;
  volatilityTolerance: VolatilityTolerance;
  goalReturnPct: number;      // decimal, e.g. 0.07
  maxDrawdownLimitPct: number; // decimal, e.g. 0.15
}

export type OptimizerActionType = 'BUY' | 'ADD' | 'REDUCE' | 'SELL' | 'HOLD';

export interface OptimizerPortfolioAction {
  ticker: string;
  action: OptimizerActionType;
  currentWeightPct: number;
  targetWeightPct: number;
  deltaWeightPct: number;
  confidence: number;
  urgency: 'high' | 'medium' | 'low';
  /** Portfolio-level rationale for this action (new in v2) */
  rationale?: string | undefined;
}

export interface OptimizerTargetWeight {
  ticker: string;
  weightPct: number;
}

export interface OptimizerRiskSummary {
  expectedReturn: number;
  portfolioVolatility: number;
  concentrationRisk: number;
  diversificationScore: number;
  maxDrawdownEstimate: number;
  cryptoAllocationPct: number;
  /** Average pairwise correlation in portfolio (0 if no data) */
  avgPairwiseCorrelation: number;
  /** Number of tickers with real historical vol data */
  tickersWithVolData: number;
  /** Largest single position weight (0-100) */
  largestPositionPct: number;
}

export interface OptimizerOutput {
  targetWeights: OptimizerTargetWeight[];
  cashWeightPct: number;
  actions: OptimizerPortfolioAction[];
  riskSummary: OptimizerRiskSummary;
  metadata: {
    candidatesConsidered: number;
    constraintsActive: string[];
    objectiveValue: number;
    solverIterations: number;
  };
}

/**
 * Covariance data structure. Callers supply:
 *   - volatilities: per-ticker annualized vol (from daily log returns)
 *   - correlations: pairwise correlation map, key = "AAPL|MSFT" (sorted), value in [-1,1]
 * If correlations is empty, the optimizer uses shrinkage toward a default correlation.
 */
export interface CovarianceData {
  volatilities: Map<string, number>;
  correlations: Map<string, number>;
}

export type CalibrationMap = Map<string, number>;

/**
 * Runtime-configurable optimizer parameters.
 * Loaded from system_config by callers with DB access.
 * If not supplied, hardcoded defaults are used.
 */
export interface OptimizerRuntimeConfig {
  baseReturnScale?: number;
  defaultCorrelation?: number;
  correlationShrinkage?: number;
  minTradePct?: number;
  frictionPerTrade?: number;
  maxClusterPct?: number;
  // Hard constraints (override shared/lib/constants.ts defaults)
  cashFloorPct?: number;
  maxPositionPct?: number;
  maxCryptoPct?: number;
  maxDailyChanges?: number;
}

// ===========================================================================
// Constants (defaults — overridden by OptimizerRuntimeConfig when supplied)
// ===========================================================================

const DEFAULTS = {
  baseReturnScale: 0.30,
  lowConfidenceThreshold: 0.3,
  nearZeroThreshold: 0.5,
  defaultVol: 0.25,
  defaultCorrelation: 0.30,
  correlationShrinkage: 0.3,
  minTradePct: 1.0,
  frictionPerTrade: 0.001,
  maxClusterPct: 45,
  // Hard constraints (mirrors constants.ts defaults)
  cashFloorPct: 0.05,
  maxPositionPct: 0.30,
  maxCryptoPct: 0.40,
  maxDailyChanges: 5,
};

// Resolved at call time from runtime config + defaults
let RC = { ...DEFAULTS };

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Stable sort key for a pair of tickers */
function corrKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ===========================================================================
// Theme / cluster grouping for concentration controls
// ===========================================================================

const THEME_CLUSTERS: Record<string, string[]> = {
  mega_tech: ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA'],
  semiconductors: ['NVDA', 'AMD', 'AVGO', 'QCOM', 'TXN', 'INTC'],
  fintech: ['SQ', 'PYPL', 'COIN', 'HOOD', 'SOFI'],
  ev_mobility: ['TSLA', 'RIVN', 'LCID', 'NIO', 'UBER', 'LYFT'],
  china_tech: ['BABA', 'JD', 'PDD', 'NIO'],
  crypto_major: ['BTC', 'ETH', 'BNB', 'SOL'],
  crypto_alt: ['XRP', 'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC', 'LTC', 'BCH'],
  broad_equity_etf: ['SPY', 'QQQ', 'VTI', 'VOO', 'IWM'],
  bond_commodity_etf: ['TLT', 'HYG', 'LQD', 'GLD', 'SLV', 'USO'],
};

/** Max allocation for any single theme cluster (prevents hidden concentration) */
// MAX_CLUSTER_PCT is now in RC.maxClusterPct

function getTickerClusters(ticker: string): string[] {
  const clusters: string[] = [];
  for (const [name, members] of Object.entries(THEME_CLUSTERS)) {
    if (members.includes(ticker)) clusters.push(name);
  }
  return clusters;
}

// ===========================================================================
// Calibration
// ===========================================================================

function scoreBucketForValue(score: number): string {
  if (score >= 0.60) return 'strong_buy';
  if (score >= 0.20) return 'buy';
  if (score >= -0.19) return 'hold';
  if (score >= -0.59) return 'sell';
  return 'strong_sell';
}

// ===========================================================================
// Expected Returns
// ===========================================================================

function computeExpectedReturn(
  s: OptimizerTickerScore,
  calibration?: CalibrationMap,
): number {
  let mu = s.compositeScore * RC.baseReturnScale;
  const confMult = s.confidence < RC.lowConfidenceThreshold
    ? s.confidence / RC.lowConfidenceThreshold * 0.5
    : 0.5 + (s.confidence - RC.lowConfidenceThreshold) / (1 - RC.lowConfidenceThreshold) * 0.5;
  mu *= confMult;
  if (s.dataFreshness === 'stale') mu *= 0.7;
  if (s.dataFreshness === 'missing') mu *= 0.3;

  if (calibration && calibration.size > 0) {
    const bucket = scoreBucketForValue(s.compositeScore);
    const calibratedMu = calibration.get(bucket);
    if (calibratedMu !== undefined) {
      let calAdj = calibratedMu * confMult;
      if (s.dataFreshness === 'stale') calAdj *= 0.7;
      if (s.dataFreshness === 'missing') calAdj *= 0.3;
      mu = calAdj * 0.6 + mu * 0.4;
    }
  }

  return mu;
}

// ===========================================================================
// Covariance-aware risk computation
// ===========================================================================

function getVol(ticker: string, cov: CovarianceData): number {
  return cov.volatilities.get(ticker) ?? RC.defaultVol;
}

function getCorrelation(a: string, b: string, cov: CovarianceData): number {
  if (a === b) return 1.0;
  const real = cov.correlations.get(corrKey(a, b));
  if (real !== undefined) {
    // Shrinkage: blend toward default to reduce estimation noise
    return real * (1 - RC.correlationShrinkage) + RC.defaultCorrelation * RC.correlationShrinkage;
  }
  // No data: use asset-type-aware defaults
  const typeA = ASSET_TYPE_MAP[a]; const typeB = ASSET_TYPE_MAP[b];
  if (typeA === 'crypto' && typeB === 'crypto') return 0.65;
  if (typeA === 'crypto' || typeB === 'crypto') return 0.15;
  // Same broad equity type: moderate correlation
  return RC.defaultCorrelation;
}

/** Compute portfolio variance from weights and covariance data. */
function portfolioVariance(
  tickers: string[], weights: number[], cov: CovarianceData,
): number {
  let variance = 0;
  for (let i = 0; i < tickers.length; i++) {
    const wi = weights[i]!;
    const volI = getVol(tickers[i]!, cov);
    for (let j = i; j < tickers.length; j++) {
      const wj = weights[j]!;
      const volJ = getVol(tickers[j]!, cov);
      const corr = getCorrelation(tickers[i]!, tickers[j]!, cov);
      const contrib = wi * wj * volI * volJ * corr;
      variance += i === j ? contrib : 2 * contrib;
    }
  }
  return Math.max(0, variance);
}

/** Average pairwise correlation for a portfolio. */
function avgPortfolioCorrelation(
  tickers: string[], weights: number[], cov: CovarianceData,
): number {
  let sumCorr = 0; let pairs = 0;
  for (let i = 0; i < tickers.length; i++) {
    for (let j = i + 1; j < tickers.length; j++) {
      if (weights[i]! > 0.001 && weights[j]! > 0.001) {
        sumCorr += getCorrelation(tickers[i]!, tickers[j]!, cov);
        pairs++;
      }
    }
  }
  return pairs > 0 ? sumCorr / pairs : 0;
}

// ===========================================================================
// Config derivation (risk-profile dependent)
// ===========================================================================

interface OptimizerConfig {
  riskAversion: number;       // lambda for variance penalty
  concentrationAversion: number; // lambda for HHI penalty
  turnoverPenalty: number;    // lambda for turnover cost
  frictionPenalty: number;    // per-trade friction cost proxy
  rebalanceBandPct: number;   // minimum delta to trigger action (%)
  minTradePct: number;        // minimum trade size to execute (%)
  clusterPenalty: number;     // penalty for theme cluster concentration
}

function deriveConfig(params: OptimizerUserParams): OptimizerConfig {
  const { riskProfile, volatilityTolerance } = params;

  let riskAversion = 3.0;
  if (riskProfile === 'conservative') riskAversion = 6.0;
  else if (riskProfile === 'aggressive') riskAversion = 1.5;
  if (volatilityTolerance === 'moderate') riskAversion *= 1.3;
  else if (volatilityTolerance === 'tolerant') riskAversion *= 0.7;

  let concentrationAversion = 1.0;
  if (riskProfile === 'conservative') concentrationAversion = 2.0;
  else if (riskProfile === 'aggressive') concentrationAversion = 0.4;

  const turnoverPenalty = 0.005; // ~50bps per unit of turnover
  const frictionPenalty = RC.frictionPerTrade;

  const rebalanceBandPct = riskProfile === 'aggressive' ? 1.5 : riskProfile === 'conservative' ? 3.0 : 2.0;
  const minTradePct = RC.minTradePct;
  const clusterPenalty = riskProfile === 'conservative' ? 1.5 : 0.8;

  return { riskAversion, concentrationAversion, turnoverPenalty, frictionPenalty, rebalanceBandPct, minTradePct, clusterPenalty };
}

// ===========================================================================
// Objective function
// ===========================================================================

function computeObjective(
  tickers: string[],
  weights: number[], // decimal (0-1)
  expectedReturns: Map<string, number>,
  cov: CovarianceData,
  currentWeights: Map<string, number>, // decimal
  config: OptimizerConfig,
  hasExistingPortfolio: boolean,
): number {
  // Expected return
  let expRet = 0;
  for (let i = 0; i < tickers.length; i++) {
    expRet += weights[i]! * (expectedReturns.get(tickers[i]!) ?? 0);
  }

  // Portfolio variance penalty
  const pVar = portfolioVariance(tickers, weights, cov);
  const riskPenalty = config.riskAversion * pVar;

  // HHI concentration penalty
  let hhi = 0;
  for (const w of weights) hhi += w * w;
  const concPenalty = config.concentrationAversion * hhi;

  // Theme cluster penalty
  let clusterPenalty = 0;
  const clusterWeights = new Map<string, number>();
  for (let i = 0; i < tickers.length; i++) {
    for (const cluster of getTickerClusters(tickers[i]!)) {
      clusterWeights.set(cluster, (clusterWeights.get(cluster) ?? 0) + weights[i]!);
    }
  }
  for (const [, cw] of clusterWeights) {
    if (cw > RC.maxClusterPct / 100) {
      clusterPenalty += config.clusterPenalty * (cw - RC.maxClusterPct / 100) ** 2;
    }
  }

  // Turnover penalty (distance from current weights)
  let turnover = 0;
  if (hasExistingPortfolio) {
    for (let i = 0; i < tickers.length; i++) {
      turnover += Math.abs(weights[i]! - (currentWeights.get(tickers[i]!) ?? 0));
    }
  }
  const turnPenalty = config.turnoverPenalty * turnover;

  // Friction penalty (count of trades that would occur)
  let tradeCount = 0;
  if (hasExistingPortfolio) {
    for (let i = 0; i < tickers.length; i++) {
      const delta = Math.abs(weights[i]! - (currentWeights.get(tickers[i]!) ?? 0));
      if (delta > config.minTradePct / 100) tradeCount++;
    }
  }
  const frictPenalty = config.frictionPenalty * tradeCount;

  return expRet - riskPenalty - concPenalty - clusterPenalty - turnPenalty - frictPenalty;
}

// ===========================================================================
// Iterative solver
// ===========================================================================

const MAX_ITERATIONS = 60;
const STEP_SIZE = 0.005; // 0.5% weight shift per iteration step

function solveWeights(
  tickers: string[],
  expectedReturns: Map<string, number>,
  cov: CovarianceData,
  currentWeights: Map<string, number>,
  config: OptimizerConfig,
  userParams: OptimizerUserParams,
  hasExistingPortfolio: boolean,
): number[] {
  const n = tickers.length;
  if (n === 0) return [];

  const investableFrac = 1 - RC.cashFloorPct;
  const maxSingleFrac = RC.maxPositionPct;
  const maxCryptoFrac = RC.maxCryptoPct;

  // Initialize: blend of expected-return-proportional and equal-weight
  const equalW = investableFrac / n;
  const mus = tickers.map((t) => expectedReturns.get(t) ?? 0);
  const minMu = Math.min(...mus);
  const shift = minMu < 0.001 ? Math.abs(minMu) + 0.001 : 0;
  const shifted = mus.map((m) => m + shift);
  const totalShifted = shifted.reduce((s, v) => s + v, 0);
  const scoreBlend = userParams.riskProfile === 'aggressive' ? 0.6 : userParams.riskProfile === 'conservative' ? 0.3 : 0.45;

  const weights = tickers.map((t, i) => {
    const scoreProp = totalShifted > 0 ? (shifted[i]! / totalShifted) * investableFrac : equalW;
    let w = scoreProp * scoreBlend + equalW * (1 - scoreBlend);
    // Turnover damping for existing positions
    const curW = currentWeights.get(t) ?? 0;
    if (hasExistingPortfolio && curW > 0.01) {
      w = w * 0.75 + curW * 0.25;
    }
    return clamp(w, 0, maxSingleFrac);
  });

  // Normalize
  normalizeWeights(weights, investableFrac, maxSingleFrac);

  // Enforce crypto cap
  enforceCryptoCap(tickers, weights, maxCryptoFrac);

  let bestObj = computeObjective(tickers, weights, expectedReturns, cov, currentWeights, config, hasExistingPortfolio);
  let bestWeights = [...weights];

  // Iterative improvement: try shifting weight between pairs
  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let improved = false;

    for (let from = 0; from < n; from++) {
      if (weights[from]! < STEP_SIZE) continue;

      for (let to = 0; to < n; to++) {
        if (from === to) continue;
        if (weights[to]! >= maxSingleFrac - STEP_SIZE) continue;

        // Try shift
        weights[from] = weights[from]! - STEP_SIZE;
        weights[to] = weights[to]! + STEP_SIZE;

        // Quick constraint check
        let valid = weights[from]! >= 0 && weights[to]! <= maxSingleFrac;
        if (valid) {
          // Check crypto cap
          let cryptoW = 0;
          for (let k = 0; k < n; k++) {
            if (ASSET_TYPE_MAP[tickers[k]!] === 'crypto') cryptoW += weights[k]!;
          }
          if (cryptoW > maxCryptoFrac) valid = false;
        }

        if (valid) {
          const obj = computeObjective(tickers, weights, expectedReturns, cov, currentWeights, config, hasExistingPortfolio);
          if (obj > bestObj + 1e-6) {
            bestObj = obj;
            bestWeights = [...weights];
            improved = true;
          }
        }

        // Revert
        weights[from] = weights[from]! + STEP_SIZE;
        weights[to] = weights[to]! - STEP_SIZE;
      }
    }

    if (!improved) break;
    // Apply best weights for next iteration
    for (let i = 0; i < n; i++) weights[i] = bestWeights[i]!;
  }

  return bestWeights;
}

function normalizeWeights(weights: number[], maxTotal: number, maxSingle: number): void {
  // Cap individual
  for (let i = 0; i < weights.length; i++) {
    weights[i] = clamp(weights[i]!, 0, maxSingle);
  }
  // Scale down if total exceeds budget
  const total = weights.reduce((s, w) => s + w, 0);
  if (total > maxTotal) {
    const scale = maxTotal / total;
    for (let i = 0; i < weights.length; i++) weights[i] = weights[i]! * scale;
  }
}

function enforceCryptoCap(tickers: string[], weights: number[], maxCrypto: number): void {
  let cryptoTotal = 0;
  const cryptoIdx: number[] = [];
  for (let i = 0; i < tickers.length; i++) {
    if (ASSET_TYPE_MAP[tickers[i]!] === 'crypto') {
      cryptoTotal += weights[i]!;
      cryptoIdx.push(i);
    }
  }
  if (cryptoTotal > maxCrypto && cryptoIdx.length > 0) {
    const scale = maxCrypto / cryptoTotal;
    for (const idx of cryptoIdx) weights[idx] = weights[idx]! * scale;
  }
}

// ===========================================================================
// Main entry point
// ===========================================================================

export function runOptimizerCore(
  scores: OptimizerTickerScore[],
  userParams: OptimizerUserParams,
  currentHoldings: OptimizerCurrentHolding[],
  historicalData: Map<string, number> | CovarianceData,
  calibration?: CalibrationMap,
  /** Runtime config from system_config DB. If omitted, uses hardcoded defaults. */
  runtimeConfig?: OptimizerRuntimeConfig,
): OptimizerOutput {
  // Apply runtime config overrides
  RC = {
    ...DEFAULTS,
    baseReturnScale: runtimeConfig?.baseReturnScale ?? DEFAULTS.baseReturnScale,
    defaultCorrelation: runtimeConfig?.defaultCorrelation ?? DEFAULTS.defaultCorrelation,
    correlationShrinkage: runtimeConfig?.correlationShrinkage ?? DEFAULTS.correlationShrinkage,
    minTradePct: runtimeConfig?.minTradePct ?? DEFAULTS.minTradePct,
    frictionPerTrade: runtimeConfig?.frictionPerTrade ?? DEFAULTS.frictionPerTrade,
    maxClusterPct: runtimeConfig?.maxClusterPct ?? DEFAULTS.maxClusterPct,
    cashFloorPct: runtimeConfig?.cashFloorPct ?? DEFAULTS.cashFloorPct,
    maxPositionPct: runtimeConfig?.maxPositionPct ?? DEFAULTS.maxPositionPct,
    maxCryptoPct: runtimeConfig?.maxCryptoPct ?? DEFAULTS.maxCryptoPct,
    maxDailyChanges: runtimeConfig?.maxDailyChanges ?? DEFAULTS.maxDailyChanges,
  };

  const config = deriveConfig(userParams);
  const currentTickers = new Set(currentHoldings.map((h) => h.ticker));
  const constraintsActive: string[] = [];
  const maxSinglePct = RC.maxPositionPct * 100;
  const maxCryptoPct = RC.maxCryptoPct * 100;

  // Normalize historicalData to CovarianceData (backward compat: plain Map = vols only)
  const cov: CovarianceData = 'correlations' in historicalData
    ? historicalData
    : { volatilities: historicalData, correlations: new Map() };

  // 1. Filter eligible tickers
  const eligible = scores.filter((s) => {
    const type = ASSET_TYPE_MAP[s.ticker] as AssetType | undefined;
    return type !== undefined && userParams.assetTypes.includes(type);
  });

  // 2. Candidate selection: current holdings + top new candidates
  const held = eligible.filter((s) => currentTickers.has(s.ticker));
  const notHeld = eligible
    .filter((s) => !currentTickers.has(s.ticker))
    .sort((a, b) => b.compositeScore - a.compositeScore);
  const maxNew = Math.max(0, userParams.maxPositions * 3 - held.length);
  const allCandidates = [...held, ...notHeld.slice(0, maxNew)];

  // 3. Compute expected returns
  const expectedReturns = new Map<string, number>();
  const withReturns = allCandidates.map((s) => {
    const er = computeExpectedReturn(s, calibration);
    expectedReturns.set(s.ticker, er);
    return { ...s, expectedReturn: er };
  });
  withReturns.sort((a, b) => b.expectedReturn - a.expectedReturn);

  // Select top N for optimization
  const selected = withReturns.slice(0, userParams.maxPositions);
  if (selected.length === 0) return emptyOutput();

  const tickers = selected.map((s) => s.ticker);

  // 4. Build current weight map (decimal 0-1)
  const currentWeightMap = new Map<string, number>();
  for (const h of currentHoldings) currentWeightMap.set(h.ticker, h.weightPct / 100);
  const hasExisting = currentHoldings.length > 0;

  // 5. Solve for optimal weights (iterative objective maximization)
  const optimalWeights = solveWeights(
    tickers, expectedReturns, cov, currentWeightMap, config, userParams, hasExisting,
  );

  // 6. Clean up tiny positions and enforce constraints
  const minPosFrac = 0.02; // 2%
  for (let i = 0; i < optimalWeights.length; i++) {
    if (optimalWeights[i]! < minPosFrac) optimalWeights[i] = 0;
  }
  normalizeWeights(optimalWeights, 1 - RC.cashFloorPct, RC.maxPositionPct);
  enforceCryptoCap(tickers, optimalWeights, RC.maxCryptoPct);

  // Check constraints
  let cryptoTotal = 0;
  for (let i = 0; i < tickers.length; i++) {
    if (ASSET_TYPE_MAP[tickers[i]!] === 'crypto') cryptoTotal += optimalWeights[i]!;
    if (optimalWeights[i]! >= RC.maxPositionPct - 0.001) constraintsActive.push(`position_cap:${tickers[i]}`);
  }
  if (cryptoTotal >= RC.maxCryptoPct - 0.01) constraintsActive.push('crypto_cap');

  // Check cluster concentrations
  const clusterW = new Map<string, number>();
  for (let i = 0; i < tickers.length; i++) {
    for (const c of getTickerClusters(tickers[i]!)) {
      clusterW.set(c, (clusterW.get(c) ?? 0) + optimalWeights[i]!);
    }
  }
  for (const [name, w] of clusterW) {
    if (w > RC.maxClusterPct / 100) constraintsActive.push(`cluster_cap:${name}`);
  }

  // 7. Build target weights
  const totalWeightPct = optimalWeights.reduce((s, w) => s + w, 0) * 100;
  const cashWeightPct = Math.max(100 - totalWeightPct, RC.cashFloorPct * 100);

  const targetWeights: OptimizerTargetWeight[] = [];
  for (let i = 0; i < tickers.length; i++) {
    const wPct = Math.round(optimalWeights[i]! * 10000) / 100;
    if (wPct > 0.5) targetWeights.push({ ticker: tickers[i]!, weightPct: wPct });
  }
  targetWeights.sort((a, b) => b.weightPct - a.weightPct);

  // 8. Compute final objective value
  const objValue = computeObjective(tickers, optimalWeights, expectedReturns, cov, currentWeightMap, config, hasExisting);

  // 9. Generate actions with friction awareness
  const actions = generateActions(targetWeights, currentHoldings, config, scores, cov);

  // 10. Compute risk summary
  const riskSummary = computeRiskSummary(tickers, optimalWeights, expectedReturns, cov, targetWeights);

  return {
    targetWeights,
    cashWeightPct: Math.round(cashWeightPct * 100) / 100,
    actions,
    riskSummary,
    metadata: {
      candidatesConsidered: eligible.length,
      constraintsActive,
      objectiveValue: objValue,
      solverIterations: MAX_ITERATIONS, // upper bound
    },
  };
}

// ===========================================================================
// Action generation (friction-aware)
// ===========================================================================

function generateActions(
  targetWeights: OptimizerTargetWeight[],
  currentHoldings: OptimizerCurrentHolding[],
  config: OptimizerConfig,
  scores: OptimizerTickerScore[],
  cov: CovarianceData,
): OptimizerPortfolioAction[] {
  const actions: OptimizerPortfolioAction[] = [];

  const currentMap = new Map<string, OptimizerCurrentHolding>();
  for (const h of currentHoldings) currentMap.set(h.ticker, h);

  const targetMap = new Map<string, number>();
  for (const tw of targetWeights) targetMap.set(tw.ticker, tw.weightPct);

  const scoreMap = new Map<string, OptimizerTickerScore>();
  for (const s of scores) scoreMap.set(s.ticker, s);

  const allTickers = new Set<string>();
  for (const h of currentHoldings) allTickers.add(h.ticker);
  for (const tw of targetWeights) allTickers.add(tw.ticker);

  for (const ticker of allTickers) {
    const currentWeight = currentMap.get(ticker)?.weightPct ?? 0;
    const targetWeight = targetMap.get(ticker) ?? 0;
    const delta = targetWeight - currentWeight;
    const confidence = scoreMap.get(ticker)?.confidence ?? 0.5;

    const currentIsZero = currentWeight < RC.nearZeroThreshold;
    const targetIsZero = targetWeight < RC.nearZeroThreshold;

    // Friction-aware action classification:
    // Use the wider of rebalanceBand and minTrade as the hold threshold
    const holdThreshold = Math.max(config.rebalanceBandPct, config.minTradePct);

    let action: OptimizerActionType;
    if (targetIsZero && !currentIsZero) action = 'SELL';
    else if (currentIsZero && !targetIsZero) action = 'BUY';
    else if (Math.abs(delta) <= holdThreshold) action = 'HOLD';
    else if (delta > 0) action = 'ADD';
    else action = 'REDUCE';

    // Skip trivial HOLDs
    if (action === 'HOLD' && Math.abs(delta) < 0.1) continue;

    let urgency: 'high' | 'medium' | 'low' = 'medium';
    if (action === 'SELL') urgency = 'high';
    else if (action === 'BUY' && Math.abs(delta) > 5 && confidence > 0.5) urgency = 'high';
    else if (Math.abs(delta) > 8) urgency = 'high';
    else if (Math.abs(delta) > 3 || confidence > 0.6) urgency = 'medium';
    else urgency = 'low';

    // Build portfolio-level rationale with risk context
    let rationale: string | undefined;
    const vol = getVol(ticker, cov);
    const assetType = ASSET_TYPE_MAP[ticker];
    const clusters = getTickerClusters(ticker);
    const isCrypto = assetType === 'crypto';

    if (action === 'SELL') {
      if (confidence < 0.4) {
        rationale = `Low confidence (${(confidence * 100).toFixed(0)}%) — reducing uncertain exposure`;
      } else {
        rationale = 'Optimizer removed this position to improve portfolio risk/return balance';
      }
    } else if (action === 'BUY') {
      const parts: string[] = ['New position'];
      if (vol > 0.4) parts.push(`high vol ${(vol * 100).toFixed(0)}% — sized conservatively`);
      else parts.push('favorable risk/return profile');
      if (clusters.length > 0) parts.push(`adds ${clusters[0]} exposure`);
      rationale = parts.join(' — ');
    } else if (action === 'REDUCE') {
      const parts: string[] = [];
      if (vol > 0.35) parts.push(`ticker vol ${(vol * 100).toFixed(0)}%`);
      if (currentWeight > 25) parts.push(`position at ${currentWeight.toFixed(0)}% is overweight`);
      if (isCrypto && currentWeight > 10) parts.push('managing crypto exposure');
      rationale = parts.length > 0 ? `Reducing: ${parts.join(', ')}` : undefined;
    } else if (action === 'ADD') {
      if (confidence > 0.6 && vol < 0.3) {
        rationale = 'Strong signal with moderate risk — increasing position';
      } else if (clusters.length > 0) {
        rationale = `Increasing ${clusters[0]} allocation based on score improvement`;
      }
    }

    actions.push({
      ticker, action,
      currentWeightPct: Math.round(currentWeight * 100) / 100,
      targetWeightPct: Math.round(targetWeight * 100) / 100,
      deltaWeightPct: Math.round(delta * 100) / 100,
      confidence, urgency, rationale,
    });
  }

  // Sort: SELL first, then BUY, REDUCE, ADD, HOLD
  const order: Record<OptimizerActionType, number> = { SELL: 0, BUY: 1, REDUCE: 2, ADD: 3, HOLD: 4 };
  actions.sort((a, b) => order[a.action] - order[b.action] || Math.abs(b.deltaWeightPct) - Math.abs(a.deltaWeightPct));

  // Enforce MAX_DAILY_CHANGES
  const nonHold = actions.filter((a) => a.action !== 'HOLD');
  if (nonHold.length > RC.maxDailyChanges) {
    const kept = new Set(nonHold.slice(0, RC.maxDailyChanges).map((a) => a.ticker));
    return actions.filter((a) => a.action === 'HOLD' || kept.has(a.ticker));
  }

  return actions;
}

// ===========================================================================
// Risk summary (covariance-aware)
// ===========================================================================

function computeRiskSummary(
  tickers: string[],
  weights: number[], // decimal
  expectedReturns: Map<string, number>,
  cov: CovarianceData,
  targetWeights: OptimizerTargetWeight[],
): OptimizerRiskSummary {
  // Expected return
  let expRet = 0;
  for (let i = 0; i < tickers.length; i++) {
    expRet += weights[i]! * (expectedReturns.get(tickers[i]!) ?? 0);
  }

  // Portfolio volatility (covariance-aware)
  const pVar = portfolioVariance(tickers, weights, cov);
  const portfolioVol = Math.sqrt(pVar);

  // Concentration
  let hhi = 0; let activeN = 0;
  for (const w of weights) {
    if (w > 0.001) { hhi += w * w; activeN++; }
  }
  const minHhi = activeN > 0 ? 1 / activeN : 0;
  const concentrationRisk = activeN > 0 && hhi > minHhi ? Math.min(1, (hhi - minHhi) / (1 - minHhi)) : 0;

  // Max drawdown estimate (Cornish-Fisher approximation: ~2.33 * vol for 99% annual)
  const maxDrawdownEstimate = Math.min(0.6, portfolioVol * 2.33);

  // Crypto allocation
  let cryptoAlloc = 0;
  for (const tw of targetWeights) {
    if (ASSET_TYPE_MAP[tw.ticker] === 'crypto') cryptoAlloc += tw.weightPct;
  }

  // Avg pairwise correlation
  const avgCorr = avgPortfolioCorrelation(tickers, weights, cov);

  // Count tickers with real vol data
  let tickersWithVol = 0;
  for (const t of tickers) {
    if (cov.volatilities.has(t)) tickersWithVol++;
  }

  // Largest position
  let largestPosPct = 0;
  for (const tw of targetWeights) {
    if (tw.weightPct > largestPosPct) largestPosPct = tw.weightPct;
  }

  return {
    expectedReturn: expRet,
    portfolioVolatility: portfolioVol,
    concentrationRisk,
    diversificationScore: 1 - concentrationRisk,
    maxDrawdownEstimate,
    cryptoAllocationPct: cryptoAlloc,
    avgPairwiseCorrelation: avgCorr,
    tickersWithVolData: tickersWithVol,
    largestPositionPct: largestPosPct,
  };
}

// ===========================================================================
// Goal probability heuristic
// ===========================================================================

export function computeGoalProbabilityHeuristic(params: {
  expectedReturn: number;
  goalReturnPct: number;
  timeHorizonMonths: number;
  positionCount: number;
  maxPositions: number;
  portfolioVolatility: number;
  concentrationRisk: number;
}): number {
  const { expectedReturn, goalReturnPct, timeHorizonMonths, positionCount, maxPositions, portfolioVolatility, concentrationRisk } = params;

  const returnGap = expectedReturn - goalReturnPct;
  const sigmoid = 1 / (1 + Math.exp(-12 * returnGap));
  let prob = sigmoid * 100;

  const divBonus = (1 - concentrationRisk) * 5;
  prob += divBonus;

  const volPenalty = Math.min(10, portfolioVolatility * 15);
  prob -= volPenalty;

  if (positionCount === 0) prob = Math.min(prob, 35);
  else if (positionCount < maxPositions * 0.5) prob -= 3;

  if (timeHorizonMonths >= 24) prob += 3;
  else if (timeHorizonMonths >= 12) prob += 1;

  return Math.round(clamp(prob, 5, 95));
}

// ===========================================================================
// Helpers
// ===========================================================================

function emptyOutput(): OptimizerOutput {
  return {
    targetWeights: [],
    cashWeightPct: 100,
    actions: [],
    riskSummary: {
      expectedReturn: 0, portfolioVolatility: 0, concentrationRisk: 0,
      diversificationScore: 1, maxDrawdownEstimate: 0, cryptoAllocationPct: 0,
      avgPairwiseCorrelation: 0, tickersWithVolData: 0, largestPositionPct: 0,
    },
    metadata: { candidatesConsidered: 0, constraintsActive: [], objectiveValue: 0, solverIterations: 0 },
  };
}
