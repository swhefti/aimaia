import type { AssetType } from '../types/assets.js';

// ---------------------------------------------------------------------------
// Asset Universe — 100 assets (60 stocks, 20 ETFs, 20 crypto)
// ---------------------------------------------------------------------------

export const STOCKS: readonly string[] = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA',
  'BRK.B', 'JPM', 'V', 'JNJ', 'UNH', 'XOM', 'PG', 'HD',
  'MA', 'LLY', 'ABBV', 'MRK', 'PEP', 'KO', 'AVGO', 'COST',
  'ADBE', 'CRM', 'NFLX', 'AMD', 'QCOM', 'TXN', 'HON',
  'BA', 'CAT', 'GS', 'MS', 'BAC', 'WMT', 'TGT', 'DIS',
  'INTC', 'IBM', 'GE', 'F', 'GM', 'UBER', 'LYFT', 'SHOP',
  'SQ', 'PYPL', 'NOW', 'SNOW', 'PLTR', 'COIN', 'RBLX',
  'HOOD', 'SOFI', 'RIVN', 'LCID', 'NIO', 'BABA', 'JD',
  'PDD', 'PINS', 'SNAP',
] as const;

export const ETFS: readonly string[] = [
  'SPY', 'QQQ', 'IWM', 'VTI', 'VOO', 'VEA', 'EEM',
  'GLD', 'SLV', 'USO', 'TLT', 'HYG', 'LQD',
  'XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'ARKK', 'SCHD',
] as const;

export const CRYPTO: readonly string[] = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX',
  'DOT', 'LINK', 'MATIC', 'LTC', 'BCH', 'ATOM',
  'UNI', 'AAVE', 'FIL', 'ICP', 'ALGO', 'XLM', 'VET',
] as const;

export const ASSET_UNIVERSE: readonly string[] = [
  ...STOCKS,
  ...ETFS,
  ...CRYPTO,
] as const;

export const ASSET_TYPE_MAP: Readonly<Record<string, AssetType>> = {
  ...Object.fromEntries(STOCKS.map((t) => [t, 'stock' as AssetType])),
  ...Object.fromEntries(ETFS.map((t) => [t, 'etf' as AssetType])),
  ...Object.fromEntries(CRYPTO.map((t) => [t, 'crypto' as AssetType])),
};

// ---------------------------------------------------------------------------
// Score Thresholds
// ---------------------------------------------------------------------------

export const SCORE_THRESHOLDS = {
  STRONG_BUY_MIN: 0.60,
  BUY_MIN: 0.20,
  HOLD_MIN: -0.19,
  SELL_MIN: -0.59,
  STRONG_SELL_MIN: -1.0,
} as const;

export function scoreToSignal(score: number): 'Strong Buy' | 'Buy' | 'Hold' | 'Sell' | 'Strong Sell' {
  if (score >= SCORE_THRESHOLDS.STRONG_BUY_MIN) return 'Strong Buy';
  if (score >= SCORE_THRESHOLDS.BUY_MIN) return 'Buy';
  if (score >= SCORE_THRESHOLDS.HOLD_MIN) return 'Hold';
  if (score >= SCORE_THRESHOLDS.SELL_MIN) return 'Sell';
  return 'Strong Sell';
}

// ---------------------------------------------------------------------------
// Default Agent Weights
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_WEIGHTS = {
  technical: 0.50,
  sentiment: 0.25,
  fundamental: 0.20,
  regime: 0.05,
} as const;

/** Per-asset-type weight profiles. Crypto has no fundamental data, so its
 *  weight is redistributed to technical and regime. */
export const AGENT_WEIGHTS_BY_ASSET_TYPE: Record<
  AssetType,
  { technical: number; sentiment: number; fundamental: number; regime: number }
> = {
  stock:  { technical: 0.50, sentiment: 0.25, fundamental: 0.20, regime: 0.05 },
  etf:    { technical: 0.50, sentiment: 0.25, fundamental: 0.20, regime: 0.05 },
  crypto: { technical: 0.50, sentiment: 0.25, fundamental: 0.00, regime: 0.25 },
};

export function getWeightsForTicker(ticker: string, sentimentMissing = false): { technical: number; sentiment: number; fundamental: number; regime: number } {
  const type = ASSET_TYPE_MAP[ticker];
  const base = type ? AGENT_WEIGHTS_BY_ASSET_TYPE[type] : DEFAULT_AGENT_WEIGHTS;

  // When crypto sentiment is missing (insufficient qualifying articles),
  // redistribute its 25% → 15% technical + 10% regime
  if (sentimentMissing && type === 'crypto') {
    return {
      technical: base.technical + 0.15,
      sentiment: 0,
      fundamental: base.fundamental,
      regime: base.regime + 0.10,
    };
  }

  return base;
}

// ---------------------------------------------------------------------------
// Other Constants
// ---------------------------------------------------------------------------

/** Exponential decay factor applied to older news sentiment scores. */
export const SENTIMENT_DECAY_FACTOR = 0.9;

/** Default maximum number of open positions per portfolio. */
export const MAX_POSITIONS_DEFAULT = 10;

/** Anthropic model used for the LLM Synthesis Agent. */
export const SYNTHESIS_MODEL = 'claude-opus-4-6';

/** Maximum allocation for a single position (Rules Engine hard limit). */
export const MAX_POSITION_PCT = 0.30;

/** Maximum allocation for all crypto positions combined (Rules Engine hard limit). */
export const MAX_CRYPTO_ALLOCATION_PCT = 0.40;

/** Minimum cash floor as a fraction of portfolio value (Rules Engine hard limit). */
export const CASH_FLOOR_PCT = 0.05;

/** Maximum number of position changes allowed per daily recommendation run. */
export const MAX_DAILY_CHANGES = 5;
