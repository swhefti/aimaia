-- System configuration table for runtime-configurable values
-- Enables prompt engineering and weight tuning without redeployment

create table if not exists system_config (
  key text primary key,
  value text not null,
  type text not null check (type in ('string', 'number', 'text')),
  label text not null,
  group_name text not null,
  description text,
  updated_at timestamptz default now()
);

alter table system_config enable row level security;

-- Service role has full access (admin panel uses service role)
create policy "Service role full access"
  on system_config
  using (true)
  with check (true);

-- Trigger to auto-update updated_at
create or replace function update_system_config_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger system_config_updated_at
  before update on system_config
  for each row
  execute function update_system_config_updated_at();

-- ============================================================================
-- Seed default configuration values
-- ============================================================================

-- Group: models
insert into system_config (key, value, type, label, group_name, description) values
  ('model_risk_report', 'claude-opus-4-6', 'string', 'Risk Report Model', 'models', 'Model for portfolio risk report generation'),
  ('model_synthesis', 'claude-sonnet-4-6', 'string', 'Synthesis Model', 'models', 'Model for daily briefing / synthesis agent'),
  ('model_conclusion', 'claude-sonnet-4-6', 'string', 'Conclusion Model', 'models', 'Model for per-ticker conclusion paragraphs'),
  ('model_sentiment', 'claude-haiku-4-5-20251001', 'string', 'Sentiment Model', 'models', 'Model for news sentiment scoring'),
  ('model_sentiment_filter', 'claude-haiku-4-5-20251001', 'string', 'Sentiment Filter Model', 'models', 'Model for crypto news relevance filter'),
  ('model_ai_probability_opus', 'claude-opus-4-6', 'string', 'AI Probability (Opus)', 'models', 'Model for Opus AI probability score'),
  ('model_ai_probability_sonnet', 'claude-sonnet-4-6', 'string', 'AI Probability (Sonnet)', 'models', 'Model for Sonnet AI probability score')
on conflict (key) do nothing;

-- Group: prompts
insert into system_config (key, value, type, label, group_name, description) values
  ('prompt_risk_report', 'You are a senior risk analyst at Bridgewater Associates trained by Ray Dalio''s principles of radical transparency in investing.
I need a complete risk assessment of my current portfolio.
Evaluate:
* Correlation analysis between my holdings
* Sector concentration risk with percentage breakdown
* Geographic exposure and currency risk factors
* Interest rate sensitivity for each position
* Recession stress test showing estimated drawdown
* Liquidity risk rating for each holding
* Single stock risk and position sizing recommendations
* Tail risk scenarios with probability estimates
* Hedging strategies to reduce my top 3 risks
* Rebalancing suggestions with specific allocation percentages
Format as a professional risk management report, nicely structured.
Positions are:
{{positions}}
Length: between 200 and 250 words.', 'text', 'Risk Report Prompt', 'prompts', 'System prompt for portfolio risk report. Use {{positions}} as placeholder for position data.'),

  ('prompt_synthesis_system', 'You are the Portfolio Synthesis Agent for an investment advisory platform.
Your role is to act as a senior analyst who:
- Reads structured evidence from four specialist agents (technical, sentiment, fundamental, regime)
- Reasons about the user''s portfolio as a whole, not just individual assets
- Considers context that rules cannot capture: macro events, concentration risk, goal trajectory, narrative momentum
- Produces actionable recommendations with clear reasoning
- Is honest about uncertainty and data quality

You are NOT a financial advisor. You are a reasoning engine that helps users make more informed decisions. All final decisions remain with the user.

Before producing your output, reason through the following in order:

STEP 1 — Assess goal trajectory
Is the portfolio on track? What is the trend (improving / stable / deteriorating)?
What is the biggest threat to reaching the goal?

STEP 2 — Evaluate portfolio health
Identify concentration risks. Are multiple positions correlated?
Is there sector or narrative overlap that creates hidden risk?

STEP 3 — Assess market regime impact
How does the current regime affect signal reliability?
Should technical signals be trusted more or less than usual?
Are any macro events directly relevant to portfolio positions?

STEP 4 — Evaluate each position
For each position, combine the agent scores with portfolio context.
A strong technical score in a bearish regime means something different than the same score in a bullish regime.

IMPORTANT — Weight profiles differ by asset type:
- Stocks & ETFs: Technical 50%, Sentiment 25%, Fundamental 20%, Regime 5%
- Crypto: Technical 50%, Sentiment 25%, Fundamental 0%, Regime 25%
- Crypto with missing sentiment data: Technical 65%, Sentiment 0%, Fundamental 0%, Regime 35%
Crypto assets have no fundamental data. Their fundamental weight is redistributed to regime.
When a crypto asset has data_freshness = ''missing'' for sentiment (insufficient qualifying news), its 25% sentiment weight is redistributed: 15% to technical, 10% to regime. Ignore the sentiment score for that asset.

STEP 5 — Identify new position candidates
From the top-scored assets not in the portfolio, assess whether any would improve diversification and goal probability.

STEP 6 — Generate structured output
Produce your JSON output. Then write the narrative.

OUTPUT FORMAT:
Return ONLY valid JSON. No preamble, no markdown fencing, no explanation outside the JSON.

The JSON must match this exact schema:
{
  "weightRationale": {
    "technical": number (0.0-1.0),
    "sentiment": number (0.0-1.0),
    "fundamental": number (0.0-1.0),
    "regime": number (0.0-1.0),
    "reasoning": string
  },
  "portfolioAssessment": {
    "goalStatus": "on_track" | "monitor" | "at_risk" | "off_track",
    "primaryRisk": string,
    "assessment": string
  },
  "recommendations": [
    {
      "ticker": string,
      "action": "BUY" | "SELL" | "REDUCE" | "ADD" | "HOLD",
      "urgency": "high" | "medium" | "low",
      "targetAllocationPct": number (0-100),
      "reasoning": string,
      "confidence": number (0.0-1.0)
    }
  ],
  "portfolioNarrative": string (max 1000 chars, 3 paragraphs max),
  "overallConfidence": number (0.0-1.0),
  "lowConfidenceReasons": string[]
}

The weights (technical + sentiment + fundamental + regime) must sum to approximately 1.0.
Include confidence scores for each recommendation and be honest about uncertainty.

CRITICAL: Only recommend tickers that appear in the CURRENT POSITIONS or NEW POSITION CANDIDATES sections above. Do NOT invent or suggest tickers not provided in the data.', 'text', 'Synthesis System Prompt', 'prompts', 'Full system prompt for the LLM Synthesis Agent'),

  ('prompt_conclusion', 'Write a single paragraph (3-5 sentences, max {{max_chars}} characters) analyzing {{name}} ({{ticker}}), a {{type}}.

Sentence 1: Brief intro — what {{name}} is/does, current price.
Sentences 2-3: What the agent scores collectively signal (technical, sentiment, fundamental, market regime) — weave into one picture.
Sentence 4-5: Current news situation and implications.

Rules: single paragraph, no bullets/headers, max {{max_chars}} chars. Be specific with numbers. Never give advice. Output ONLY the paragraph.', 'text', 'Conclusion Prompt', 'prompts', 'Template for per-ticker conclusion generation. Placeholders: {{name}}, {{ticker}}, {{type}}, {{max_chars}}'),

  ('prompt_sentiment', 'You are a financial sentiment analyst. Analyze news for {{ticker}}. Return ONLY valid JSON.', 'text', 'Sentiment Prompt', 'prompts', 'System prompt for news sentiment scoring. Placeholder: {{ticker}}'),

  ('prompt_sentiment_filter', 'You classify whether a crypto asset is the PRIMARY subject of news articles. Return ONLY valid JSON.', 'text', 'Sentiment Filter Prompt', 'prompts', 'System prompt for crypto news relevance filter'),

  ('prompt_ai_probability', 'You are a portfolio probability analyst. Given a user''s investment portfolio and their financial goal, estimate the probability (0-100%) that they will achieve their target return within the remaining time horizon.

Consider:
- Current portfolio performance vs goal (progress so far)
- Time remaining and what annualized return is still needed
- Portfolio composition and diversification
- Individual position performance (winners vs losers)
- Cash allocation (uninvested capital)
- Risk profile alignment
- Market realism (is the needed return achievable for the asset mix?)

Do NOT use any external scoring, sentiment analysis, or technical indicators. Base your estimate purely on the portfolio''s fundamentals, the goal parameters, and general market knowledge.

Return ONLY a JSON object: {"probability": number, "reasoning": string}
The probability must be between 0 and 100. The reasoning should be 1-2 sentences max.', 'text', 'AI Probability Prompt', 'prompts', 'System prompt for AI goal probability estimation')
on conflict (key) do nothing;

-- Group: scoring_weights
insert into system_config (key, value, type, label, group_name, description) values
  ('weight_stock_technical', '0.50', 'number', 'Stock Technical Weight', 'scoring_weights', 'Technical analysis weight for stocks & ETFs'),
  ('weight_stock_sentiment', '0.25', 'number', 'Stock Sentiment Weight', 'scoring_weights', 'Sentiment analysis weight for stocks & ETFs'),
  ('weight_stock_fundamental', '0.20', 'number', 'Stock Fundamental Weight', 'scoring_weights', 'Fundamental analysis weight for stocks & ETFs'),
  ('weight_stock_regime', '0.05', 'number', 'Stock Regime Weight', 'scoring_weights', 'Market regime weight for stocks & ETFs'),
  ('weight_crypto_technical', '0.50', 'number', 'Crypto Technical Weight', 'scoring_weights', 'Technical analysis weight for crypto'),
  ('weight_crypto_sentiment', '0.25', 'number', 'Crypto Sentiment Weight', 'scoring_weights', 'Sentiment analysis weight for crypto'),
  ('weight_crypto_fundamental', '0.00', 'number', 'Crypto Fundamental Weight', 'scoring_weights', 'Fundamental weight for crypto (should be 0)'),
  ('weight_crypto_regime', '0.25', 'number', 'Crypto Regime Weight', 'scoring_weights', 'Market regime weight for crypto'),
  ('weight_crypto_sentiment_missing_technical', '0.65', 'number', 'Crypto (no sentiment) Technical', 'scoring_weights', 'Technical weight when crypto sentiment data is missing'),
  ('weight_crypto_sentiment_missing_regime', '0.35', 'number', 'Crypto (no sentiment) Regime', 'scoring_weights', 'Regime weight when crypto sentiment data is missing')
on conflict (key) do nothing;

-- Group: technical_sub_weights
insert into system_config (key, value, type, label, group_name, description) values
  ('subweight_technical_macd', '0.30', 'number', 'MACD Weight', 'technical_sub_weights', 'Weight of MACD indicator in technical score'),
  ('subweight_technical_ema', '0.25', 'number', 'EMA Weight', 'technical_sub_weights', 'Weight of EMA crossover in technical score'),
  ('subweight_technical_rsi', '0.20', 'number', 'RSI Weight', 'technical_sub_weights', 'Weight of RSI in technical score'),
  ('subweight_technical_bollinger', '0.15', 'number', 'Bollinger Weight', 'technical_sub_weights', 'Weight of Bollinger Bands in technical score'),
  ('subweight_technical_volume', '0.10', 'number', 'Volume Weight', 'technical_sub_weights', 'Weight of volume analysis in technical score')
on conflict (key) do nothing;

-- Group: output_limits
insert into system_config (key, value, type, label, group_name, description) values
  ('max_chars_conclusion', '450', 'number', 'Max Chars (Conclusion)', 'output_limits', 'Maximum character length for ticker conclusion paragraphs'),
  ('max_chars_synthesis_narrative', '1000', 'number', 'Max Chars (Narrative)', 'output_limits', 'Maximum character length for portfolio narrative'),
  ('max_tokens_conclusion', '300', 'number', 'Max Tokens (Conclusion)', 'output_limits', 'Max output tokens for conclusion generation'),
  ('max_tokens_sentiment', '300', 'number', 'Max Tokens (Sentiment)', 'output_limits', 'Max output tokens for sentiment scoring'),
  ('max_tokens_synthesis', '4096', 'number', 'Max Tokens (Synthesis)', 'output_limits', 'Max output tokens for synthesis LLM call'),
  ('max_tokens_risk_report', '1024', 'number', 'Max Tokens (Risk Report)', 'output_limits', 'Max output tokens for risk report generation'),
  ('max_tokens_ai_probability', '300', 'number', 'Max Tokens (AI Probability)', 'output_limits', 'Max output tokens for AI probability estimation')
on conflict (key) do nothing;

-- Group: data_windows
insert into system_config (key, value, type, label, group_name, description) values
  ('sentiment_lookback_days', '10', 'number', 'Sentiment Lookback (days)', 'data_windows', 'Number of days of news history used for sentiment scoring'),
  ('sentiment_min_articles_crypto', '3', 'number', 'Min Crypto Articles', 'data_windows', 'Minimum qualifying articles needed to score crypto sentiment'),
  ('sentiment_decay_factor', '0.9', 'number', 'Sentiment Decay Factor', 'data_windows', 'Daily decay multiplier for sentiment scores with no new news'),
  ('technical_lookback_days', '250', 'number', 'Technical Lookback (rows)', 'data_windows', 'Number of price history rows used for technical indicators'),
  ('technical_min_rows_confidence_high', '200', 'number', 'High Confidence Rows', 'data_windows', 'Minimum rows needed for high confidence technical score'),
  ('technical_min_rows_confidence_low', '50', 'number', 'Low Confidence Rows', 'data_windows', 'Minimum rows needed to compute any technical score')
on conflict (key) do nothing;

-- Group: probability_math
insert into system_config (key, value, type, label, group_name, description) values
  ('prob_sigmoid_midpoint', '0.08', 'number', 'Sigmoid Midpoint', 'probability_math', 'Annualised return at which probability = 50% (e.g. 0.08 = 8%)'),
  ('prob_sigmoid_steepness', '12', 'number', 'Sigmoid Steepness', 'probability_math', 'How sharply probability drops as needed return increases'),
  ('prob_ai_score_weight', '8', 'number', 'AI Score Weight', 'probability_math', 'Max points added/subtracted by composite AI score (-1 to +1)'),
  ('prob_progress_bonus_max', '10', 'number', 'Progress Bonus Max', 'probability_math', 'Maximum bonus points for being ahead of schedule'),
  ('prob_diversification_bonus_max', '3', 'number', 'Diversification Bonus Max', 'probability_math', 'Maximum bonus points for portfolio diversification'),
  ('prob_time_bonus_max', '5', 'number', 'Time Bonus Max', 'probability_math', 'Maximum bonus points for long time horizons'),
  ('prob_no_positions_cap', '35', 'number', 'No Positions Cap', 'probability_math', 'Probability cap when portfolio is 100% cash')
on conflict (key) do nothing;
