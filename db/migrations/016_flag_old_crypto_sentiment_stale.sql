-- Migration 016: Flag old crypto sentiment scores as stale
-- One-time fix: crypto sentiment scores before 2026-03-08 may be based on
-- irrelevant articles (passing mentions). Mark them as stale so the system
-- doesn't rely on them.

UPDATE agent_scores
SET data_freshness = 'stale'
WHERE agent_type = 'sentiment'
  AND date < '2026-03-08'
  AND ticker IN (
    'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX',
    'DOT', 'LINK', 'MATIC', 'LTC', 'BCH', 'ATOM',
    'UNI', 'AAVE', 'FIL', 'ICP', 'ALGO', 'XLM', 'VET'
  )
  AND data_freshness != 'stale';
