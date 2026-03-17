-- Migration 030: Seed optimizer, calibration, and explainer config keys into system_config.
-- These make live optimizer/calibration controls editable from admin.

-- Optimizer constraints
INSERT INTO system_config (key, value, type, label, group_name, description) VALUES
  ('optimizer_cash_floor_pct', '0.05', 'number', 'Cash Floor %', 'optimizer', 'Minimum cash reserve as fraction'),
  ('optimizer_max_position_pct', '0.30', 'number', 'Max Position %', 'optimizer', 'Maximum single position weight'),
  ('optimizer_max_crypto_pct', '0.40', 'number', 'Max Crypto %', 'optimizer', 'Maximum total crypto allocation'),
  ('optimizer_max_daily_changes', '5', 'number', 'Max Daily Changes', 'optimizer', 'Maximum position changes per day'),
  ('optimizer_base_return_scale', '0.30', 'number', 'Base Return Scale', 'optimizer', 'Score-to-return multiplier'),
  ('optimizer_default_correlation', '0.30', 'number', 'Default Correlation', 'optimizer', 'Fallback pairwise correlation'),
  ('optimizer_correlation_shrinkage', '0.30', 'number', 'Correlation Shrinkage', 'optimizer', 'Blend factor toward default correlation'),
  ('optimizer_min_trade_pct', '1.0', 'number', 'Min Trade %', 'optimizer', 'Minimum trade size to generate action'),
  ('optimizer_friction_per_trade', '0.001', 'number', 'Friction Per Trade', 'optimizer', 'Transaction cost proxy per trade'),
  ('optimizer_max_cluster_pct', '45', 'number', 'Max Cluster %', 'optimizer', 'Maximum allocation per theme cluster')
ON CONFLICT (key) DO NOTHING;

-- Calibration rollout
INSERT INTO system_config (key, value, type, label, group_name, description) VALUES
  ('calibration_live_enabled', '1', 'number', 'Live Enabled', 'calibration', 'Global kill switch (1=on, 0=off)'),
  ('calibration_min_samples', '20', 'number', 'Min Samples', 'calibration', 'Minimum samples per bucket'),
  ('calibration_preferred_30d_samples', '10', 'number', 'Preferred 30d Samples', 'calibration', 'Preferred 30d-return samples'),
  ('calibration_7d_only_weight', '0.4', 'number', '7d-Only Weight', 'calibration', 'Calibration influence with 7d-only data'),
  ('calibration_max_age_days', '30', 'number', 'Max Age (days)', 'calibration', 'Calibration staleness limit')
ON CONFLICT (key) DO NOTHING;

-- Optimizer explainer prompt (replaces legacy prompt_synthesis_system for active path)
INSERT INTO system_config (key, value, type, label, group_name, description) VALUES
  ('prompt_optimizer_explainer', 'You are an investment communication writer. The portfolio optimizer has determined the following target changes.
Your job is to explain WHY these changes make sense in plain language, including how they affect portfolio risk. Do NOT suggest alternatives or override the optimizer.
When explaining actions, reference portfolio-level risk where relevant (concentration, diversification, volatility, correlation).
Return ONLY valid JSON:
{"portfolioNarrative": string (max 800 chars, plain language briefing), "actionExplanations": {"TICKER": "reason for this action", ...}, "goalStatus": "on_track"|"monitor"|"at_risk"|"off_track", "overallAssessment": string}', 'text', 'Explainer Prompt', 'briefing', 'System prompt for optimizer action explanations')
ON CONFLICT (key) DO NOTHING;
