/**
 * Admin Config Manifest — single source of truth for all admin-editable settings.
 *
 * Every config key must be defined here with:
 * - metadata (label, description, type, group)
 * - runtime status (live, legacy, manual_only, dead)
 * - validation rules
 * - consumer information
 */

export type ConfigStatus = 'live' | 'manual_only' | 'legacy' | 'dead';
export type ConfigType = 'string' | 'number' | 'text';

export interface ConfigEntry {
  key: string;
  label: string;
  description: string;
  type: ConfigType;
  group: string;
  status: ConfigStatus;
  consumers: string[];
  /** For numbers: validation range */
  min?: number;
  max?: number;
  /** For weight groups: keys that must sum to ~1.0 */
  weightGroup?: string;
  /** Warning shown in admin UI */
  warning?: string;
}

export interface ConfigGroup {
  id: string;
  label: string;
  description: string;
  status: ConfigStatus;
  /** Keys that must sum to ~1.0 within this group */
  weightKeys?: string[];
}

// ===========================================================================
// Groups
// ===========================================================================

export const CONFIG_GROUPS: ConfigGroup[] = [
  { id: 'sentiment', label: 'Sentiment Agent', description: 'News sentiment scoring model and parameters', status: 'live' },
  { id: 'technical_sub', label: 'Technical Sub-Weights', description: 'Indicator weights within technical scoring', status: 'live', weightKeys: ['subweight_technical_macd', 'subweight_technical_ema', 'subweight_technical_rsi', 'subweight_technical_bollinger', 'subweight_technical_volume'] },
  { id: 'fundamental_sub', label: 'Fundamental Sub-Weights', description: 'Factor weights within fundamental scoring', status: 'live', weightKeys: ['subweight_fundamental_pe', 'subweight_fundamental_revenue', 'subweight_fundamental_margin', 'subweight_fundamental_roe', 'subweight_fundamental_debt'] },
  { id: 'conclusion', label: 'Conclusion Agent', description: 'Per-ticker conclusion generation', status: 'live' },
  { id: 'briefing', label: 'Daily Brief / Explanations', description: 'Optimizer-first explanation prompt and model', status: 'live' },
  { id: 'optimizer', label: 'Optimizer Constraints', description: 'Hard constraints and tuning for portfolio optimizer', status: 'live' },
  { id: 'calibration', label: 'Calibration Rollout', description: 'Controls when calibrated expected returns affect live optimizer', status: 'live' },
  { id: 'ai_probability', label: 'AI Probability', description: 'Cross-check probability estimation via LLM', status: 'live' },
  { id: 'risk_report', label: 'Risk Report', description: 'LLM-generated portfolio risk analysis', status: 'live' },
  { id: 'composite_weights', label: 'Composite Weights', description: 'Agent score blending weights per asset type', status: 'live', weightKeys: ['weight_stock_technical', 'weight_stock_sentiment', 'weight_stock_fundamental', 'weight_stock_regime'] },
  { id: 'legacy', label: 'Legacy / Manual Only', description: 'Settings from previous architecture versions', status: 'legacy' },
];

// ===========================================================================
// Config entries
// ===========================================================================

export const CONFIG_MANIFEST: ConfigEntry[] = [
  // ---- Sentiment Agent (live) ----
  { key: 'model_sentiment', label: 'Sentiment Model', description: 'Model for news sentiment scoring', type: 'string', group: 'sentiment', status: 'live', consumers: ['backend/jobs/scores.ts'] },
  { key: 'model_sentiment_filter', label: 'Sentiment Filter Model', description: 'Model for crypto news relevance filter', type: 'string', group: 'sentiment', status: 'live', consumers: ['backend/jobs/scores.ts'] },
  { key: 'prompt_sentiment', label: 'Sentiment Prompt', description: 'System prompt for news sentiment scoring', type: 'text', group: 'sentiment', status: 'live', consumers: ['backend/jobs/scores.ts'] },
  { key: 'prompt_sentiment_filter', label: 'Sentiment Filter Prompt', description: 'System prompt for crypto news relevance filter', type: 'text', group: 'sentiment', status: 'live', consumers: ['backend/jobs/scores.ts'] },
  { key: 'max_tokens_sentiment', label: 'Max Tokens (Sentiment)', description: 'Max output tokens for sentiment scoring', type: 'number', group: 'sentiment', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 100, max: 2000 },
  { key: 'sentiment_lookback_days', label: 'Lookback (days)', description: 'Days of news history for sentiment scoring', type: 'number', group: 'sentiment', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 1, max: 30 },
  { key: 'sentiment_min_articles_crypto', label: 'Min Crypto Articles', description: 'Minimum qualifying articles for crypto sentiment', type: 'number', group: 'sentiment', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 1, max: 20 },
  { key: 'sentiment_decay_factor', label: 'Decay Factor', description: 'Daily decay for sentiment with no new news', type: 'number', group: 'sentiment', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1 },

  // ---- Technical Sub-Weights (live) ----
  { key: 'subweight_technical_macd', label: 'MACD Weight', description: 'Weight of MACD in technical score', type: 'number', group: 'technical_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'technical_sub' },
  { key: 'subweight_technical_ema', label: 'EMA Weight', description: 'Weight of EMA crossover', type: 'number', group: 'technical_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'technical_sub' },
  { key: 'subweight_technical_rsi', label: 'RSI Weight', description: 'Weight of RSI', type: 'number', group: 'technical_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'technical_sub' },
  { key: 'subweight_technical_bollinger', label: 'Bollinger Weight', description: 'Weight of Bollinger Bands', type: 'number', group: 'technical_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'technical_sub' },
  { key: 'subweight_technical_volume', label: 'Volume Weight', description: 'Weight of volume analysis', type: 'number', group: 'technical_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'technical_sub' },

  // ---- Fundamental Sub-Weights (live) ----
  { key: 'subweight_fundamental_pe', label: 'P/E Weight', description: 'Weight of P/E ratio', type: 'number', group: 'fundamental_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'fundamental_sub' },
  { key: 'subweight_fundamental_revenue', label: 'Revenue Weight', description: 'Weight of revenue growth', type: 'number', group: 'fundamental_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'fundamental_sub' },
  { key: 'subweight_fundamental_margin', label: 'Margin Weight', description: 'Weight of profit margin', type: 'number', group: 'fundamental_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'fundamental_sub' },
  { key: 'subweight_fundamental_roe', label: 'ROE Weight', description: 'Weight of return on equity', type: 'number', group: 'fundamental_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'fundamental_sub' },
  { key: 'subweight_fundamental_debt', label: 'Debt Weight', description: 'Weight of debt-to-equity', type: 'number', group: 'fundamental_sub', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 0, max: 1, weightGroup: 'fundamental_sub' },

  // ---- Conclusion Agent (live) ----
  { key: 'model_conclusion', label: 'Conclusion Model', description: 'Model for per-ticker conclusions', type: 'string', group: 'conclusion', status: 'live', consumers: ['backend/jobs/scores.ts'] },
  { key: 'prompt_conclusion', label: 'Conclusion Prompt', description: 'Template for conclusion generation', type: 'text', group: 'conclusion', status: 'live', consumers: ['backend/jobs/scores.ts'] },
  { key: 'max_tokens_conclusion', label: 'Max Tokens', description: 'Max output tokens for conclusions', type: 'number', group: 'conclusion', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 100, max: 1000 },
  { key: 'max_chars_conclusion', label: 'Max Chars', description: 'Max character length for conclusions', type: 'number', group: 'conclusion', status: 'live', consumers: ['backend/jobs/scores.ts'], min: 100, max: 1000 },

  // ---- Daily Brief / Explanations (live) ----
  { key: 'model_synthesis', label: 'Explanation Model', description: 'Model used for optimizer explanation / daily brief', type: 'string', group: 'briefing', status: 'live', consumers: ['backend/jobs/synthesis.ts'] },
  { key: 'prompt_optimizer_explainer', label: 'Explainer Prompt', description: 'System prompt for optimizer action explanations. The LLM explains optimizer decisions, it does not invent them.', type: 'text', group: 'briefing', status: 'live', consumers: ['backend/jobs/synthesis.ts'] },
  { key: 'max_tokens_synthesis', label: 'Max Tokens', description: 'Max output tokens for explanation', type: 'number', group: 'briefing', status: 'live', consumers: ['backend/jobs/synthesis.ts'], min: 500, max: 8192 },

  // ---- Optimizer Constraints (live) ----
  { key: 'optimizer_cash_floor_pct', label: 'Cash Floor %', description: 'Minimum cash reserve as fraction (0.05 = 5%)', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/constants.ts'], min: 0.01, max: 0.50 },
  { key: 'optimizer_max_position_pct', label: 'Max Position %', description: 'Maximum single position weight (0.30 = 30%)', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/constants.ts'], min: 0.05, max: 0.50 },
  { key: 'optimizer_max_crypto_pct', label: 'Max Crypto %', description: 'Maximum total crypto allocation (0.40 = 40%)', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/constants.ts'], min: 0, max: 1 },
  { key: 'optimizer_max_daily_changes', label: 'Max Daily Changes', description: 'Maximum position changes per day', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/optimizer-core.ts'], min: 1, max: 20 },
  { key: 'optimizer_base_return_scale', label: 'Base Return Scale', description: 'Score-to-return multiplier (0.30 = score of +1 maps to 30% annual)', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/optimizer-core.ts'], min: 0.05, max: 1 },
  { key: 'optimizer_default_correlation', label: 'Default Correlation', description: 'Fallback pairwise correlation when no data', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/optimizer-core.ts'], min: 0, max: 1 },
  { key: 'optimizer_correlation_shrinkage', label: 'Correlation Shrinkage', description: 'Blend factor toward default correlation (0.3 = 30%)', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/optimizer-core.ts'], min: 0, max: 1 },
  { key: 'optimizer_min_trade_pct', label: 'Min Trade %', description: 'Minimum trade size to generate action (1.0 = 1%)', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/optimizer-core.ts'], min: 0.1, max: 5 },
  { key: 'optimizer_friction_per_trade', label: 'Friction Per Trade', description: 'Transaction cost proxy per trade (0.001 = 10bps)', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/optimizer-core.ts'], min: 0, max: 0.01 },
  { key: 'optimizer_max_cluster_pct', label: 'Max Cluster %', description: 'Maximum allocation per theme cluster (45 = 45%)', type: 'number', group: 'optimizer', status: 'live', consumers: ['shared/lib/optimizer-core.ts'], min: 10, max: 100 },

  // ---- Calibration Rollout (live) ----
  { key: 'calibration_live_enabled', label: 'Live Enabled', description: 'Global kill switch for calibration. Set to 0 to revert to heuristic-only.', type: 'number', group: 'calibration', status: 'live', consumers: ['shared/lib/calibration-config.ts', 'backend/jobs/synthesis.ts'], min: 0, max: 1 },
  { key: 'calibration_min_samples', label: 'Min Samples', description: 'Minimum samples per bucket for live eligibility', type: 'number', group: 'calibration', status: 'live', consumers: ['shared/lib/calibration-config.ts'], min: 5, max: 100 },
  { key: 'calibration_preferred_30d_samples', label: 'Preferred 30d Samples', description: 'Preferred 30d-return samples for full calibration weight', type: 'number', group: 'calibration', status: 'live', consumers: ['shared/lib/calibration-config.ts'], min: 3, max: 50 },
  { key: 'calibration_7d_only_weight', label: '7d-Only Weight', description: 'Calibration influence when only 7d data exists (vs 0.6 for 30d)', type: 'number', group: 'calibration', status: 'live', consumers: ['shared/lib/calibration-config.ts'], min: 0, max: 1 },
  { key: 'calibration_max_age_days', label: 'Max Age (days)', description: 'Calibration staleness limit', type: 'number', group: 'calibration', status: 'live', consumers: ['shared/lib/calibration-config.ts'], min: 7, max: 90 },

  // ---- AI Probability (live) ----
  { key: 'model_ai_probability_opus', label: 'AI Prob Model (Opus)', description: 'Model for Opus AI probability cross-check', type: 'string', group: 'ai_probability', status: 'live', consumers: ['frontend/app/api/portfolio/ai-probability'] },
  { key: 'model_ai_probability_sonnet', label: 'AI Prob Model (Sonnet)', description: 'Model for Sonnet AI probability cross-check', type: 'string', group: 'ai_probability', status: 'live', consumers: ['frontend/app/api/portfolio/ai-probability'] },
  { key: 'prompt_ai_probability', label: 'AI Prob Prompt', description: 'Prompt for AI probability estimation', type: 'text', group: 'ai_probability', status: 'live', consumers: ['frontend/app/api/portfolio/ai-probability'] },
  { key: 'max_tokens_ai_probability', label: 'Max Tokens (AI Prob)', description: 'Max output tokens for AI probability', type: 'number', group: 'ai_probability', status: 'live', consumers: ['frontend/app/api/portfolio/ai-probability'], min: 100, max: 1000 },

  // ---- Risk Report (live) ----
  { key: 'model_risk_report', label: 'Risk Report Model', description: 'Model for portfolio risk report', type: 'string', group: 'risk_report', status: 'live', consumers: ['frontend/app/api/portfolio/risk-report'] },
  { key: 'prompt_risk_report', label: 'Risk Report Prompt', description: 'System prompt for risk report', type: 'text', group: 'risk_report', status: 'live', consumers: ['frontend/app/api/portfolio/risk-report'] },
  { key: 'max_tokens_risk_report', label: 'Max Tokens (Risk)', description: 'Max output tokens for risk report', type: 'number', group: 'risk_report', status: 'live', consumers: ['frontend/app/api/portfolio/risk-report'], min: 256, max: 4096 },

  // ---- Composite Weights (live — used by /api/config/weights and UI) ----
  { key: 'weight_stock_technical', label: 'Stock Technical', description: 'Technical weight for stocks/ETFs', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1, weightGroup: 'composite_stock' },
  { key: 'weight_stock_sentiment', label: 'Stock Sentiment', description: 'Sentiment weight for stocks/ETFs', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1, weightGroup: 'composite_stock' },
  { key: 'weight_stock_fundamental', label: 'Stock Fundamental', description: 'Fundamental weight for stocks/ETFs', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1, weightGroup: 'composite_stock' },
  { key: 'weight_stock_regime', label: 'Stock Regime', description: 'Regime weight for stocks/ETFs', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1, weightGroup: 'composite_stock' },
  { key: 'weight_crypto_technical', label: 'Crypto Technical', description: 'Technical weight for crypto', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1 },
  { key: 'weight_crypto_sentiment', label: 'Crypto Sentiment', description: 'Sentiment weight for crypto', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1 },
  { key: 'weight_crypto_fundamental', label: 'Crypto Fundamental', description: 'Fundamental weight for crypto (should be 0)', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1 },
  { key: 'weight_crypto_regime', label: 'Crypto Regime', description: 'Regime weight for crypto', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1 },
  { key: 'weight_crypto_sentiment_missing_technical', label: 'Crypto (no sent) Technical', description: 'Technical weight when crypto sentiment missing', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1 },
  { key: 'weight_crypto_sentiment_missing_regime', label: 'Crypto (no sent) Regime', description: 'Regime weight when crypto sentiment missing', type: 'number', group: 'composite_weights', status: 'live', consumers: ['frontend/app/api/config/weights'], min: 0, max: 1 },

  // ---- Legacy / Manual Only ----
  { key: 'prompt_synthesis_system', label: 'Legacy Synthesis Prompt', description: 'Old LLM-decides-recommendations prompt. Superseded by optimizer-first architecture.', type: 'text', group: 'legacy', status: 'legacy', consumers: ['frontend/app/api/cron/synthesis (legacy route)'], warning: 'This prompt is NOT used by the active daily synthesis job. Edit prompt_optimizer_explainer instead.' },
  { key: 'max_chars_synthesis_narrative', label: 'Legacy Max Chars Narrative', description: 'Max chars for synthesis narrative. Not read by active optimizer-first job.', type: 'number', group: 'legacy', status: 'legacy', consumers: [], warning: 'Not used by active runtime path.' },
  { key: 'technical_lookback_days', label: 'Technical Lookback', description: 'Hardcoded in scores.ts (250 rows). Config value not read.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
  { key: 'technical_min_rows_confidence_high', label: 'Tech Min Rows (High)', description: 'Hardcoded in scores.ts. Config value not read.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
  { key: 'technical_min_rows_confidence_low', label: 'Tech Min Rows (Low)', description: 'Hardcoded in scores.ts. Config value not read.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
  { key: 'prob_sigmoid_midpoint', label: 'Prob Sigmoid Midpoint', description: 'Heuristic probability param. Not read by active runtime.', type: 'number', group: 'legacy', status: 'dead', consumers: [], warning: 'Probability heuristic uses hardcoded values in optimizer-core.ts' },
  { key: 'prob_sigmoid_steepness', label: 'Prob Sigmoid Steepness', description: 'Heuristic probability param. Not read by active runtime.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
  { key: 'prob_ai_score_weight', label: 'Prob AI Score Weight', description: 'Not read by active runtime.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
  { key: 'prob_progress_bonus_max', label: 'Prob Progress Bonus', description: 'Not read by active runtime.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
  { key: 'prob_diversification_bonus_max', label: 'Prob Div Bonus', description: 'Not read by active runtime.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
  { key: 'prob_time_bonus_max', label: 'Prob Time Bonus', description: 'Not read by active runtime.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
  { key: 'prob_no_positions_cap', label: 'Prob No Positions Cap', description: 'Not read by active runtime.', type: 'number', group: 'legacy', status: 'dead', consumers: [] },
];

// ===========================================================================
// Helpers
// ===========================================================================

export function getManifestEntry(key: string): ConfigEntry | undefined {
  return CONFIG_MANIFEST.find((e) => e.key === key);
}

export function getGroupEntries(groupId: string): ConfigEntry[] {
  return CONFIG_MANIFEST.filter((e) => e.group === groupId);
}

export function getGroupById(groupId: string): ConfigGroup | undefined {
  return CONFIG_GROUPS.find((g) => g.id === groupId);
}
