# Pipeline Agent Notes

## Files Created

```
backend/
  tsconfig.json                              <- backend TS config
  pipeline/
    run.ts                                   <- manual entry point
    providers/
      twelve-data.ts                         <- Twelve Data API client (OHLCV, quotes)
      finnhub.ts                             <- Finnhub API client (news, fundamentals)
    ingestion/
      price-ingestion.ts                     <- OHLCV + quotes -> price_history, market_quotes
      news-ingestion.ts                      <- Company + market news -> news_data
      fundamentals-ingestion.ts              <- Stock/ETF metrics -> fundamental_data
      macro-events-ingestion.ts              <- LLM-classified macro events -> macro_events
      backfill.ts                            <- Historical price backfill (200 days)
    scheduler/
      daily-pipeline.ts                      <- Pipeline orchestration (prices -> news+fundamentals -> macro)
      cron.ts                                <- Cron schedules (daily 6pm UTC + crypto every 6h)
    utils/
      ticker-map.ts                          <- Ticker format conversion (internal -> provider)
```

## Data Shapes Written to DB

### `price_history` (upsert on `ticker,date`)
| Column | Type | Notes |
|---|---|---|
| ticker | text | Internal ticker (e.g. AAPL, BTC) |
| date | text | ISO date (e.g. 2025-01-15) |
| open | numeric | |
| high | numeric | |
| low | numeric | |
| close | numeric | Never 0 or null |
| volume | numeric | |

### `market_quotes` (upsert on `ticker,date`)
| Column | Type | Notes |
|---|---|---|
| ticker | text | Internal ticker |
| date | text | Date of latest quote |
| last_price | numeric | Latest closing price |
| daily_change | numeric | Absolute USD change from prior close |
| pct_change | numeric | Decimal, e.g. 0.02 for +2% |
| ingested_at | timestamptz | Auto-set by DB |

### `news_data` (upsert on `url`)
| Column | Type | Notes |
|---|---|---|
| ticker | text | Internal ticker, or `_MARKET` for market-wide news |
| headline | text | Never empty |
| summary | text | nullable |
| source | text | |
| published_at | timestamptz | |
| url | text | Unique constraint for dedup |

### `fundamental_data` (upsert on `ticker,date`)
| Column | Type | Notes |
|---|---|---|
| ticker | text | Stocks and ETFs only, never crypto |
| date | text | ISO date |
| pe_ratio, ps_ratio | numeric | nullable |
| revenue_growth_yoy, profit_margin, roe | numeric | Decimals (0.15 = 15%), nullable |
| market_cap | numeric | USD, nullable |
| debt_to_equity | numeric | nullable |

### `macro_events` (insert)
| Column | Type | Notes |
|---|---|---|
| date | text | ISO date |
| event_description | text | |
| event_type | text | fed_decision, cpi_release, earnings, geopolitical, etc. |
| relevant_asset_types | text[] | ['stock', 'etf', 'crypto'] |
| relevant_tickers | text[] | Empty array if broad market |
| sentiment | numeric | -1.0 to +1.0 |
| source_url | text | nullable |

## Provider Quirks the Analysis Agent Should Know

1. **Crypto tickers**: Internally stored as `BTC`, `ETH`, etc. Provider mapping is handled in the pipeline layer. The Analysis Agent reads from DB using internal tickers only.

2. **Market-wide news**: Stored with `ticker = '_MARKET'`. Filter on `ticker = '_MARKET'` to get general market news; filter on specific tickers for company news.

3. **Fundamental data**: Only exists for stocks and ETFs. Crypto tickers will have no rows in `fundamental_data` — this is expected, not an error. The Fundamental Agent should treat missing crypto fundamentals as "not applicable."

4. **Data freshness**: Price data is fetched daily (Mon-Fri for stocks, every 6h for crypto). On weekends, stock prices will be from Friday. Mark `dataFreshness` as `'stale'` if price data is >1 day old for stocks.

5. **Staleness for fundamentals**: Only re-fetched if no record exists within the last 7 days.

6. **Rate limits**: Twelve Data is the bottleneck at 8 req/min. Assets are processed in batches of 6 with 10-second delays. A full universe run takes ~15-20 minutes.

7. **LLM for macro events**: Uses `claude-haiku-4-5-20251001` (fast, cheap) for macro event classification. Produces 0-5 events per day.

## Usage

```bash
# Manual full pipeline run
npx ts-node --esm backend/pipeline/run.ts --mode=full

# Prices only
npx ts-node --esm backend/pipeline/run.ts --mode=prices-only

# News only
npx ts-node --esm backend/pipeline/run.ts --mode=news-only

# Backfill 200 days of price history
npx ts-node --esm backend/pipeline/run.ts --mode=backfill --days=200

# Start cron scheduler (long-running)
npx ts-node --esm backend/pipeline/run.ts --mode=scheduler
```

## Status

- [x] Twelve Data provider client (OHLCV + quotes, rate limiting, retry)
- [x] Finnhub provider client (news, fundamentals, crypto ticker mapping, retry)
- [x] Ticker mapping utility (internal <-> Twelve Data / Finnhub formats)
- [x] Price ingestion module (price_history + market_quotes)
- [x] News ingestion module (company + market news, URL dedup)
- [x] Fundamentals ingestion module (stocks/ETFs only, 7-day staleness check)
- [x] Macro events ingestion module (LLM classification via Claude Haiku)
- [x] Daily pipeline orchestrator (correct execution order)
- [x] Cron scheduler (daily 6pm UTC + crypto every 6h)
- [x] Backfill script (200 days, respects rate limits)
- [x] Manual run.ts entry point (full/prices-only/news-only/backfill/scheduler modes)
- [x] TypeScript compiles with no errors (`npx tsc --noEmit`)
