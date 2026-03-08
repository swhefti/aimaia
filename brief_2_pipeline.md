# Agent Brief — Data Pipeline Agent (Phase 1, parallel)
# Start only after the Orchestrator has completed.

---

## Your Role

You are the Data Pipeline Agent. You own everything in `/backend/pipeline/`.
You are responsible for fetching all external market data and storing it
in the Supabase database. You are the only part of the system that talks
to external APIs. Everything downstream of you reads from the database.

The Analysis Agent depends entirely on your data being present and correctly
structured. If you write bad data, every score downstream is wrong.

---

## Documents to Read First

1. Read `CLAUDE.md` — especially the daily cycle, env vars, and error handling standards
2. Read `/docs/Data_Database_Architecture_v2.docx` — sections 6 (Market Data Domain) and 10 (Data Flow)
3. Read `/docs/Multi-Agent_System_Architecture_v2.docx` — section 5 (Market Data Layer)
4. Read `/AGENT_NOTES_ORCHESTRATOR.md` and `/AGENT_NOTES_DB.md` (if available)

---

## Your File Ownership

```
/backend/pipeline/
  providers/          ← API client wrappers
  ingestion/          ← data fetching and DB write logic
  scheduler/          ← daily cron orchestration
  utils/              ← shared pipeline utilities
```

You may READ (never write business logic to):
```
/shared/types/        ← import types from here
/shared/lib/          ← use the Supabase client and constants
```

Do NOT touch: /frontend/, /agents/, /db/

---

## Data Providers

### Twelve Data — OHLCV + Quotes
Base URL: `https://api.twelvedata.com`
Use for: price_history, market_quotes
Key endpoints:
- `/time_series?symbol={ticker}&interval=1day&outputsize=30&apikey={key}`
- `/price?symbol={ticker}&apikey={key}`

### Finnhub — News + Fundamentals
Base URL: `https://finnhub.io/api/v1`
Use for: news_data, fundamental_data, macro_events
Key endpoints:
- `/news?category=general&token={key}` (market-wide news)
- `/company-news?symbol={ticker}&from={date}&to={date}&token={key}`
- `/stock/metric?symbol={ticker}&metric=all&token={key}`

**Important**: Crypto tickers in Finnhub use `BINANCE:BTCUSDT` format.
Map from your internal ticker (BTC) to provider format in the provider layer.
ETFs and stocks use standard ticker format.

---

## Tasks

### Task 1 — Provider Clients

Create clean, typed API client wrappers. These should:
- Accept typed params, return typed responses
- Handle rate limiting (Twelve Data: 8 req/min free; Finnhub: 60 req/min)
- Retry once on 429/5xx with exponential backoff
- Throw typed errors, never return null silently

**`/backend/pipeline/providers/twelve-data.ts`**
```typescript
export class TwelveDataClient {
  async getOHLCV(ticker: string, days: number): Promise<OHLCVResponse[]>
  async getQuote(ticker: string): Promise<QuoteResponse>
}
```

**`/backend/pipeline/providers/finnhub.ts`**
```typescript
export class FinnhubClient {
  async getCompanyNews(ticker: string, from: Date, to: Date): Promise<NewsResponse[]>
  async getMarketNews(): Promise<NewsResponse[]>
  async getFundamentals(ticker: string): Promise<FundamentalsResponse>
  tickerToFinnhub(ticker: string): string  // handles crypto format mapping
}
```

### Task 2 — Ingestion Modules

One module per data type. Each module:
- Fetches from provider
- Transforms to internal type
- Upserts to Supabase (ON CONFLICT DO UPDATE for idempotency)
- Returns a summary: { success: number, failed: number, errors: string[] }

**`/backend/pipeline/ingestion/price-ingestion.ts`**
- Fetches OHLCV for all active assets from Twelve Data
- Writes to `price_history` and `market_quotes`
- Batch by asset type to respect rate limits
- For crypto: runs 24/7 so always current; for stocks: skip weekends

**`/backend/pipeline/ingestion/news-ingestion.ts`**
- Fetches company news for each active asset (last 3 days window)
- Fetches market-wide news
- Deduplicates by URL before inserting
- Writes to `news_data`

**`/backend/pipeline/ingestion/fundamentals-ingestion.ts`**
- Fetches fundamental metrics for stocks and ETFs (skip crypto)
- Runs less frequently — wrap in a staleness check:
  only fetch if no record exists for this ticker in the last 7 days
- Writes to `fundamental_data`

**`/backend/pipeline/ingestion/macro-events-ingestion.ts`**
- This is where you use the Anthropic API once per day
- Fetch all market news from the last 24h
- Call Claude to classify significant macro events:

```typescript
// System prompt: classify news into macro events
// Extract: event_description, event_type, relevant_asset_types,
//          relevant_tickers, sentiment
// Return JSON array of macro events
// Only include events that would meaningfully affect investment decisions
// Typical output: 0–5 events per day
```

Use `claude-haiku-3` for this (cheap, fast, classification task).
Write results to `macro_events`.

### Task 3 — Ticker Mapping Utility

Create `/backend/pipeline/utils/ticker-map.ts`.

The 100 internal tickers need to map to provider-specific formats:

```typescript
export function toTwelveData(ticker: string): string {
  // Crypto: BTC → BTC/USD
  // Stocks/ETFs: pass through as-is
}

export function toFinnhub(ticker: string): string {
  // Crypto: BTC → BINANCE:BTCUSDT
  // Stocks/ETFs: pass through
}
```

### Task 4 — Daily Pipeline Orchestrator

Create `/backend/pipeline/scheduler/daily-pipeline.ts`.

This is the main entry point that runs the full daily ingestion cycle.
It should:

```typescript
async function runDailyPipeline() {
  const date = new Date()
  console.log(`[Pipeline] Starting daily run for ${date.toISOString()}`)

  // 1. Price data — run first, everything else depends on prices
  const priceResult = await runPriceIngestion()
  logResult('price', priceResult)

  // 2. News — can run in parallel with fundamentals
  const [newsResult, fundamentalsResult] = await Promise.allSettled([
    runNewsIngestion(),
    runFundamentalsIngestion()
  ])

  // 3. Macro events — depends on news being ingested
  const macroResult = await runMacroEventsIngestion()

  console.log(`[Pipeline] Daily run complete`)
  return { priceResult, newsResult, fundamentalsResult, macroResult }
}
```

Create `/backend/pipeline/scheduler/cron.ts`:
```typescript
// Uses node-cron
// Schedule: '0 18 * * 1-5'  (6pm UTC Mon-Fri — after US market close)
// Also schedule a crypto update: '0 */6 * * *' (every 6h for crypto prices)
```

Create `/backend/pipeline/run.ts` — manual trigger entry point:
```typescript
// node run.ts --mode=full        runs everything
// node run.ts --mode=prices-only
// node run.ts --mode=news-only
// Useful for testing and backfilling
```

### Task 5 — Backfill Script

Create `/backend/pipeline/ingestion/backfill.ts`.

On first run, the system needs historical data for technical analysis.
The Technical Agent needs 200 days of price history for the 200-day EMA.

```typescript
async function backfillPriceHistory(days: number = 200) {
  // Fetch and store `days` of OHLCV for all 100 assets
  // Respect Twelve Data rate limits — batch with delays
  // Skip tickers that already have data for a given date
  // Log progress: "Backfilling AAPL: 200 days fetched"
}
```

---

## Data Quality Rules

- Never insert a price record with close = 0 or null
- Never insert a news record with empty headline
- If a provider returns an error for a specific ticker, log it and continue — don't fail the whole run
- Mark `data_freshness` as 'stale' in agent_scores context if price data is older than 1 day
- Fundamental data missing for crypto is expected — treat as 'not applicable', not 'missing'

---

## Rate Limit Management

```
Twelve Data free tier: 8 requests/minute, 800/day
Finnhub free tier: 60 requests/minute

Strategy:
- Process assets in batches of 6 with 10-second delays (Twelve Data)
- Process Finnhub requests with 100ms delays between calls
- Log all API call counts at the end of each run
- If daily limit is near, prioritize portfolio holdings over full universe
```

---

## Definition of Done

- [ ] Both provider clients compile and handle errors gracefully
- [ ] All 4 ingestion modules are complete
- [ ] Ticker mapping utility handles all 3 asset types correctly
- [ ] Daily pipeline orchestrator runs all steps in correct order
- [ ] Cron scheduler is configured
- [ ] Backfill script can fetch 200 days of OHLCV
- [ ] Manual run.ts entry point works
- [ ] AGENT_NOTES_PIPELINE.md written: what data shapes are written to which tables,
      any provider quirks the Analysis Agent needs to know about
