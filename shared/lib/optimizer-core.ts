/**
 * Shared Optimizer Core — single source of truth for target-weight computation.
 *
 * Used by:
 *   1. frontend/app/api/optimizer/build/route.ts  (onboarding)
 *   2. backend/jobs/synthesis.ts                   (daily management)
 *
 * This module MUST NOT import from backend/ or frontend/. It lives in shared/
 * so both workspaces can import it without cross-workspace hacks.
 */
import { ASSET_TYPE_MAP, MAX_POSITION_PCT, MAX_CRYPTO_ALLOCATION_PCT, CASH_FLOOR_PCT, MAX_DAILY_CHANGES } from './constants.js';
import type { AssetType } from '../types/assets.js';
import type { RiskProfile, VolatilityTolerance } from '../types/portfolio.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
}

export interface OptimizerTargetWeight {
  ticker: string;
  weightPct: number;
}

export interface OptimizerRiskSummary {
  expectedReturn: number;      // annualized decimal
  portfolioVolatility: number; // annualized decimal (0 if no historical data)
  concentrationRisk: number;   // [0, 1]
  diversificationScore: number; // [0, 1]
  maxDrawdownEstimate: number; // decimal
  cryptoAllocationPct: number; // 0–100
}

export interface OptimizerOutput {
  targetWeights: OptimizerTargetWeight[];
  cashWeightPct: number;
  actions: OptimizerPortfolioAction[];
  riskSummary: OptimizerRiskSummary;
  metadata: {
    candidatesConsidered: number;
    constraintsActive: string[];
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_RETURN_SCALE = 0.30;
const LOW_CONFIDENCE_THRESHOLD = 0.3;
const NEAR_ZERO_THRESHOLD = 0.5; // weight % below which position is "zero"

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// Calibration (optional data-backed expected return override)
// ---------------------------------------------------------------------------

/**
 * Calibration map: score_bucket → calibrated annualized expected return.
 * If provided, the optimizer blends calibrated values with the heuristic.
 * Loaded from `score_calibration` table by callers that have DB access.
 */
export type CalibrationMap = Map<string, number>;

function scoreBucketForValue(score: number): string {
  if (score >= 0.60) return 'strong_buy';
  if (score >= 0.20) return 'buy';
  if (score >= -0.19) return 'hold';
  if (score >= -0.59) return 'sell';
  return 'strong_sell';
}

// ---------------------------------------------------------------------------
// Expected Returns
// ---------------------------------------------------------------------------

function computeExpectedReturn(
  s: OptimizerTickerScore,
  calibration?: CalibrationMap,
): number {
  // Heuristic expected return
  let mu = s.compositeScore * BASE_RETURN_SCALE;
  const confMult = s.confidence < LOW_CONFIDENCE_THRESHOLD
    ? s.confidence / LOW_CONFIDENCE_THRESHOLD * 0.5
    : 0.5 + (s.confidence - LOW_CONFIDENCE_THRESHOLD) / (1 - LOW_CONFIDENCE_THRESHOLD) * 0.5;
  mu *= confMult;
  if (s.dataFreshness === 'stale') mu *= 0.7;
  if (s.dataFreshness === 'missing') mu *= 0.3;

  // Blend with calibrated value if available
  if (calibration && calibration.size > 0) {
    const bucket = scoreBucketForValue(s.compositeScore);
    const calibratedMu = calibration.get(bucket);
    if (calibratedMu !== undefined) {
      // Apply confidence/freshness damping to calibrated value too
      let calAdj = calibratedMu * confMult;
      if (s.dataFreshness === 'stale') calAdj *= 0.7;
      if (s.dataFreshness === 'missing') calAdj *= 0.3;
      // Blend: 60% calibrated + 40% heuristic (calibrated takes priority)
      mu = calAdj * 0.6 + mu * 0.4;
    }
  }

  return mu;
}

// ---------------------------------------------------------------------------
// Config derivation
// ---------------------------------------------------------------------------

interface OptimizerConfig {
  rebalanceBandPct: number;
  scoreBlend: number;  // 0–1, higher = more score-proportional
  turnoverDamping: number; // 0–1, higher = more bias toward current weights
}

function deriveConfig(params: OptimizerUserParams): OptimizerConfig {
  const { riskProfile } = params;
  const rebalanceBandPct = riskProfile === 'aggressive' ? 1.5 : riskProfile === 'conservative' ? 3.0 : 2.0;
  const scoreBlend = riskProfile === 'aggressive' ? 0.7 : riskProfile === 'conservative' ? 0.3 : 0.5;
  const turnoverDamping = 0.3; // blend 30% toward current weight for existing positions
  return { rebalanceBandPct, scoreBlend, turnoverDamping };
}

// ---------------------------------------------------------------------------
// Core optimizer — single allocation engine
// ---------------------------------------------------------------------------

export function runOptimizerCore(
  scores: OptimizerTickerScore[],
  userParams: OptimizerUserParams,
  currentHoldings: OptimizerCurrentHolding[],
  /** Annualized volatility per ticker (from historical returns). Empty map = no vol data. */
  tickerVolatilities: Map<string, number>,
  /** Optional calibration from score_calibration table. If empty/undefined, uses heuristic only. */
  calibration?: CalibrationMap,
): OptimizerOutput {
  const config = deriveConfig(userParams);
  const currentTickers = new Set(currentHoldings.map((h) => h.ticker));
  const constraintsActive: string[] = [];
  const investablePct = 100 * (1 - CASH_FLOOR_PCT);
  const maxSinglePct = MAX_POSITION_PCT * 100;
  const maxCryptoPct = MAX_CRYPTO_ALLOCATION_PCT * 100;

  // 1. Filter eligible tickers by allowed asset types
  const eligible = scores.filter((s) => {
    const type = ASSET_TYPE_MAP[s.ticker] as AssetType | undefined;
    return type !== undefined && userParams.assetTypes.includes(type);
  });

  // 2. Always include current holdings; add top new candidates
  const held = eligible.filter((s) => currentTickers.has(s.ticker));
  const notHeld = eligible
    .filter((s) => !currentTickers.has(s.ticker))
    .sort((a, b) => b.compositeScore - a.compositeScore);
  const maxNew = Math.max(0, userParams.maxPositions * 3 - held.length);
  const allCandidates = [...held, ...notHeld.slice(0, maxNew)];

  // 3. Compute expected returns and rank
  const withReturns = allCandidates.map((s) => ({
    ...s,
    expectedReturn: computeExpectedReturn(s, calibration),
  }));
  withReturns.sort((a, b) => b.expectedReturn - a.expectedReturn);

  const selected = withReturns.slice(0, userParams.maxPositions);
  if (selected.length === 0) {
    return emptyOutput();
  }

  // 4. Score-proportional allocation
  const minMu = Math.min(...selected.map((s) => s.expectedReturn));
  const shift = minMu < 0.001 ? Math.abs(minMu) + 0.001 : 0;
  const shifted = selected.map((s) => s.expectedReturn + shift);
  const totalShifted = shifted.reduce((sum, v) => sum + v, 0);
  const equalPct = investablePct / selected.length;

  const currentWeightMap = new Map<string, number>();
  for (const h of currentHoldings) currentWeightMap.set(h.ticker, h.weightPct);

  let weights = selected.map((s, i) => {
    const scorePct = totalShifted > 0
      ? (shifted[i]! / totalShifted) * investablePct
      : equalPct;
    let blended = scorePct * config.scoreBlend + equalPct * (1 - config.scoreBlend);

    // Turnover damping: blend toward current weight for existing positions
    const currentW = currentWeightMap.get(s.ticker);
    if (currentW !== undefined && currentW > 0) {
      blended = blended * (1 - config.turnoverDamping) + currentW * config.turnoverDamping;
    }

    return clamp(blended, 2, maxSinglePct);
  });

  // 5. Enforce crypto cap
  let cryptoTotal = 0;
  const cryptoIdx: number[] = [];
  for (let i = 0; i < selected.length; i++) {
    if (ASSET_TYPE_MAP[selected[i]!.ticker] === 'crypto') {
      cryptoTotal += weights[i]!;
      cryptoIdx.push(i);
    }
  }
  if (cryptoTotal > maxCryptoPct && cryptoIdx.length > 0) {
    constraintsActive.push('crypto_cap');
    const scale = maxCryptoPct / cryptoTotal;
    for (const idx of cryptoIdx) weights[idx] = weights[idx]! * scale;
  }

  // 6. Normalize so total invested <= investablePct
  const totalW = weights.reduce((s, w) => s + w, 0);
  if (totalW > investablePct) {
    const scale = investablePct / totalW;
    weights = weights.map((w) => w * scale);
  }

  // 7. Build target weights (filter dust)
  const finalTotal = weights.reduce((s, w) => s + w, 0);
  const cashWeightPct = Math.max(100 - finalTotal, CASH_FLOOR_PCT * 100);

  const targetWeights: OptimizerTargetWeight[] = selected
    .map((s, i) => ({ ticker: s.ticker, weightPct: Math.round(weights[i]! * 100) / 100 }))
    .filter((tw) => tw.weightPct > 0.5);

  // 8. Generate deterministic actions
  const actions = generateActions(
    targetWeights, currentHoldings, config.rebalanceBandPct, scores,
  );

  // 9. Compute risk summary
  const riskSummary = computeRiskSummary(
    targetWeights, selected, tickerVolatilities,
  );

  return {
    targetWeights,
    cashWeightPct: Math.round(cashWeightPct * 100) / 100,
    actions,
    riskSummary,
    metadata: {
      candidatesConsidered: eligible.length,
      constraintsActive,
    },
  };
}

// ---------------------------------------------------------------------------
// Action generation
// ---------------------------------------------------------------------------

function generateActions(
  targetWeights: OptimizerTargetWeight[],
  currentHoldings: OptimizerCurrentHolding[],
  rebalanceBandPct: number,
  scores: OptimizerTickerScore[],
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

    const currentIsZero = currentWeight < NEAR_ZERO_THRESHOLD;
    const targetIsZero = targetWeight < NEAR_ZERO_THRESHOLD;

    let action: OptimizerActionType;
    if (targetIsZero && !currentIsZero) action = 'SELL';
    else if (currentIsZero && !targetIsZero) action = 'BUY';
    else if (Math.abs(delta) <= rebalanceBandPct) action = 'HOLD';
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

    actions.push({
      ticker,
      action,
      currentWeightPct: Math.round(currentWeight * 100) / 100,
      targetWeightPct: Math.round(targetWeight * 100) / 100,
      deltaWeightPct: Math.round(delta * 100) / 100,
      confidence,
      urgency,
    });
  }

  // Sort: SELL first, then BUY, REDUCE, ADD, HOLD; by abs delta within tier
  const order: Record<OptimizerActionType, number> = { SELL: 0, BUY: 1, REDUCE: 2, ADD: 3, HOLD: 4 };
  actions.sort((a, b) => order[a.action] - order[b.action] || Math.abs(b.deltaWeightPct) - Math.abs(a.deltaWeightPct));

  // Enforce MAX_DAILY_CHANGES — remove suppressed actions entirely rather than
  // mutating them to HOLD with contradictory target/delta values.
  const nonHold = actions.filter((a) => a.action !== 'HOLD');
  if (nonHold.length > MAX_DAILY_CHANGES) {
    const kept = new Set(nonHold.slice(0, MAX_DAILY_CHANGES).map((a) => a.ticker));
    return actions.filter((a) => a.action === 'HOLD' || kept.has(a.ticker));
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Risk summary
// ---------------------------------------------------------------------------

function computeRiskSummary(
  targetWeights: OptimizerTargetWeight[],
  scoredCandidates: Array<OptimizerTickerScore & { expectedReturn: number }>,
  tickerVolatilities: Map<string, number>,
): OptimizerRiskSummary {
  const DEFAULT_VOL = 0.25;
  const AVG_CORR = 0.3; // cross-term approximation

  // Expected return
  let expRet = 0;
  for (const tw of targetWeights) {
    const cand = scoredCandidates.find((c) => c.ticker === tw.ticker);
    expRet += (tw.weightPct / 100) * (cand?.expectedReturn ?? 0);
  }

  // Portfolio volatility (weighted vol with cross-correlation approximation)
  let weightedVarSum = 0;
  for (const tw of targetWeights) {
    const vol = tickerVolatilities.get(tw.ticker) ?? DEFAULT_VOL;
    const w = tw.weightPct / 100;
    weightedVarSum += w * w * vol * vol;
  }
  for (let i = 0; i < targetWeights.length; i++) {
    const twi = targetWeights[i]!;
    const volI = tickerVolatilities.get(twi.ticker) ?? DEFAULT_VOL;
    for (let j = i + 1; j < targetWeights.length; j++) {
      const twj = targetWeights[j]!;
      const volJ = tickerVolatilities.get(twj.ticker) ?? DEFAULT_VOL;
      weightedVarSum += 2 * (twi.weightPct / 100) * (twj.weightPct / 100) * AVG_CORR * volI * volJ;
    }
  }
  const portfolioVol = Math.sqrt(Math.max(0, weightedVarSum));

  // Concentration / diversification
  let hhi = 0;
  const n = targetWeights.length;
  for (const tw of targetWeights) {
    const w = tw.weightPct / 100;
    hhi += w * w;
  }
  const minHhi = n > 0 ? 1 / n : 0;
  const concentrationRisk = n > 0 && hhi > minHhi
    ? Math.min(1, (hhi - minHhi) / (1 - minHhi))
    : 0;

  // Max drawdown estimate: 2 * vol (rough annual worst case)
  const maxDrawdownEstimate = Math.min(0.5, portfolioVol * 2);

  // Crypto allocation
  let cryptoAlloc = 0;
  for (const tw of targetWeights) {
    if (ASSET_TYPE_MAP[tw.ticker] === 'crypto') cryptoAlloc += tw.weightPct;
  }

  return {
    expectedReturn: expRet,
    portfolioVolatility: portfolioVol,
    concentrationRisk,
    diversificationScore: 1 - concentrationRisk,
    maxDrawdownEstimate,
    cryptoAllocationPct: cryptoAlloc,
  };
}

// ---------------------------------------------------------------------------
// Goal probability heuristic (v1 — temporary, pragmatic)
// ---------------------------------------------------------------------------

/**
 * Compute a pragmatic v1 goal probability from optimizer outputs.
 * This is NOT the full AI probability model — it's a signal-aware heuristic
 * that replaces the hardcoded `50`.
 *
 * Inputs: expected return, goal return, time horizon, diversification, volatility.
 * Output: 0–100 probability estimate.
 */
export function computeGoalProbabilityHeuristic(params: {
  expectedReturn: number;       // annualized decimal from optimizer
  goalReturnPct: number;        // decimal, e.g. 0.07 for 7%
  timeHorizonMonths: number;
  positionCount: number;
  maxPositions: number;
  portfolioVolatility: number;  // annualized decimal
  concentrationRisk: number;    // [0, 1]
}): number {
  const { expectedReturn, goalReturnPct, timeHorizonMonths, positionCount, maxPositions, portfolioVolatility, concentrationRisk } = params;

  // Base: sigmoid mapping of needed-return vs expected-return
  const neededAnnualReturn = goalReturnPct; // already annualized decimal
  const returnGap = expectedReturn - neededAnnualReturn;
  // sigmoid: P = 1 / (1 + exp(-k * gap))  with k=12
  const sigmoid = 1 / (1 + Math.exp(-12 * returnGap));
  let prob = sigmoid * 100;

  // Diversification bonus: up to +5 for well-diversified
  const divBonus = (1 - concentrationRisk) * 5;
  prob += divBonus;

  // Volatility penalty: high vol reduces confidence
  const volPenalty = Math.min(10, portfolioVolatility * 15);
  prob -= volPenalty;

  // Position count bonus: having positions is better than all cash
  if (positionCount === 0) prob = Math.min(prob, 35);
  else if (positionCount < maxPositions * 0.5) prob -= 3;

  // Time horizon bonus: longer = more room to recover
  if (timeHorizonMonths >= 24) prob += 3;
  else if (timeHorizonMonths >= 12) prob += 1;

  return Math.round(clamp(prob, 5, 95));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyOutput(): OptimizerOutput {
  return {
    targetWeights: [],
    cashWeightPct: 100,
    actions: [],
    riskSummary: {
      expectedReturn: 0,
      portfolioVolatility: 0,
      concentrationRisk: 0,
      diversificationScore: 1,
      maxDrawdownEstimate: 0,
      cryptoAllocationPct: 0,
    },
    metadata: { candidatesConsidered: 0, constraintsActive: [] },
  };
}
