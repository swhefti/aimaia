-- Add fundamental sub-weights to system_config (same pattern as technical sub-weights)
insert into system_config (key, value, type, label, group_name, description) values
  ('subweight_fundamental_pe',       '0.25', 'number', 'P/E Ratio weight',        'fundamental_sub_weights', 'Weight of P/E score in fundamental total'),
  ('subweight_fundamental_revenue',  '0.25', 'number', 'Revenue Growth weight',    'fundamental_sub_weights', 'Weight of revenue growth score'),
  ('subweight_fundamental_margin',   '0.15', 'number', 'Profit Margin weight',     'fundamental_sub_weights', 'Weight of profit margin score'),
  ('subweight_fundamental_roe',      '0.20', 'number', 'Return on Equity weight',  'fundamental_sub_weights', 'Weight of ROE score'),
  ('subweight_fundamental_debt',     '0.15', 'number', 'Debt/Equity weight',       'fundamental_sub_weights', 'Weight of debt/equity score'),
  -- Composite agent weights (stock/ETF)
  ('weight_stock_technical',    '0.50', 'number', 'Stock Technical weight',    'scoring_weights', 'Weight of technical score for stocks/ETFs'),
  ('weight_stock_sentiment',    '0.25', 'number', 'Stock Sentiment weight',    'scoring_weights', 'Weight of sentiment score for stocks/ETFs'),
  ('weight_stock_fundamental',  '0.20', 'number', 'Stock Fundamental weight',  'scoring_weights', 'Weight of fundamental score for stocks/ETFs'),
  ('weight_stock_regime',       '0.05', 'number', 'Stock Regime weight',       'scoring_weights', 'Weight of regime score for stocks/ETFs'),
  -- Composite agent weights (crypto)
  ('weight_crypto_technical',   '0.50', 'number', 'Crypto Technical weight',   'scoring_weights', 'Weight of technical score for crypto'),
  ('weight_crypto_sentiment',   '0.25', 'number', 'Crypto Sentiment weight',   'scoring_weights', 'Weight of sentiment score for crypto'),
  ('weight_crypto_fundamental', '0.00', 'number', 'Crypto Fundamental weight', 'scoring_weights', 'Weight of fundamental score for crypto (0 = disabled)'),
  ('weight_crypto_regime',      '0.25', 'number', 'Crypto Regime weight',      'scoring_weights', 'Weight of regime score for crypto')
on conflict (key) do nothing;
