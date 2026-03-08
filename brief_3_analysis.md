# Agent Brief — Analysis Engine Agent (Phase 1, parallel)
# Start only after the Orchestrator has completed.

---

## Your Role

You are the Analysis Engine Agent. You own everything in `/agents/`.
You build the intelligence core of the product — the four mathematical
scoring agents AND the LLM Synthesis Agent.

This is the most complex agent brief. Read it fully before writing
any code. The LLM Synthesis Agent is the product's core moat and
requires particular care.

---

## Documents to Read First

Read ALL of these before writing any code:

1. `CLAUDE.md` — contracts, score normalization, daily cycle
2. `/docs/Multi-Agent_System_Architecture_v2.docx` — sections 7–15 (all agents + synthesis)
3. `/docs/LLM_Synthesis_Agent_Spec.docx` — read this completely, it is your primary spec
4. `/docs/Data_Database_Architecture_v2.docx` — sections 7 and 9 (analysis + recommendation domains)
5. `/AGENT_NOTES_ORCHESTRATOR.md` — shared types you must import
6. `/AGENT_NOTES_DB.md` (if available) — schema details

---

## Your File Ownership

```
/agents/
  technical/
  sentiment/
  fundamental/
  regime/
  synthesis/
    context-builder.ts
    prompt-builder.ts
    llm-caller.ts
    output-validator.ts
    rules-engine.ts
    narrative-formatter.ts
    index.ts
  runner/
    daily-runner.ts     ← orchestrates all agents for a given date
    index.ts
```

Do NOT touch: /frontend/, /backend/, /db/

---

## Part 1 — Mathematical Scoring Agents

Each agent follows the same interface:

```typescript
interface ScoringAgent {
  run(ticker: string, date: Date): Promise<AgentScore>
  runBatch(tickers: string[], date: Date): Promise<AgentScore[]>
}
```

All agents read from the database (never from external APIs directly).
All agents write their results to `agent_scores`.

---

### Agent 1 — Technical Analysis Agent

**File**: `/agents/technical/index.ts`

Reads from: `price_history` (needs at least 200 days for 200 EMA)

**Indicators to implement** (all from OHLCV data):

```typescript
// RSI (14-period)
// Returns: < 30 → oversold (+0.7), > 70 → overbought (-0.5), else proportional
function calculateRSI(closes: number[], period = 14): number

// MACD (12, 26, 9 signal)
// Returns: bullish crossover (+0.5), bearish crossover (-0.5), trend direction
function calculateMACD(closes: number[]): { macdLine: number, signalLine: number, histogram: number }

// EMA trend (20, 50, 200 day)
// Returns: price above 20 EMA (+0.3), 20 EMA above 50 EMA (+0.3), 50 EMA above 200 EMA (+0.3)
function calculateEMAs(closes: number[]): { ema20: number, ema50: number, ema200: number }

// Bollinger Bands (20 period, 2 std dev)
// Returns: near lower band (+0.3), near upper band (-0.3)
function calculateBollinger(closes: number[]): { upper: number, middle: number, lower: number, position: number }

// Volume trend (current vol vs 20-day average)
// Returns: above average volume on up day (+0.2), above average on down day (-0.2)
function calculateVolumeSignal(closes: number[], volumes: number[]): number
```

**Scoring formula** (from spec):
```typescript
const technicalScore =
  (macdScore   * 0.30) +
  (emaScore    * 0.25) +
  (rsiScore    * 0.20) +
  (bollingerScore * 0.15) +
  (volumeScore * 0.10)
```

Clamp final score to [-1.0, +1.0].

**Confidence**: based on data completeness and indicator agreement.
If price history < 200 days: confidence = 0.5. If indicators agree directionally: confidence +0.2.

**Component scores**: store each indicator's contribution in `component_scores` jsonb.

---

### Agent 2 — Sentiment Analysis Agent

**File**: `/agents/sentiment/index.ts`

Reads from: `news_data` (last 10 days for the ticker)

This agent uses the Anthropic API — one call per ticker per day.
Use `claude-haiku-3` (fast and cheap for classification).

**Prompt design**:
```
System: You are a financial sentiment analyst. Analyze the provided news
headlines and summaries for {ticker}. Return ONLY valid JSON, no preamble.

User: Analyze these {n} news items from the last 10 days:
[list of headlines + summaries with dates]

Return JSON:
{
  "sentiment_score": float (-1.0 to +1.0),
  "confidence": float (0.0 to 1.0),
  "key_themes": string[],
  "reasoning": string (max 100 words)
}
```

**Sentiment decay**: If no news today, apply decay to yesterday's score:
```typescript
const decayedScore = previousScore * SENTIMENT_DECAY_FACTOR  // 0.9
```

If no news exists at all for a ticker: score = 0, confidence = 0.1.

**Confidence** is based on: number of news items (more = higher confidence),
recency of items, source diversity.

---

### Agent 3 — Fundamental Analysis Agent

**File**: `/agents/fundamental/index.ts`

Reads from: `fundamental_data`

**Scoring logic** (implement these rules):

```typescript
// P/E ratio scoring (vs sector median — use hardcoded sector medians for MVP)
// Low P/E relative to sector → positive
// Negative P/E (loss-making) → strongly negative
function scorePE(peRatio: number, sectorMedianPE: number): number

// Revenue growth scoring
// > 20% YoY → +0.5, 10-20% → +0.3, 0-10% → +0.1, negative → -0.4
function scoreRevenueGrowth(growthPct: number): number

// Margin trend
// Expanding → +0.3, stable → 0, contracting → -0.3
function scoreMargin(margin: number): number

// ROE scoring
// > 20% → +0.3, 10-20% → +0.1, < 0% → -0.4
function scoreROE(roe: number): number

// Debt scoring
// debt_to_equity > 3 → -0.3, 1-3 → -0.1, < 1 → +0.1
function scoreDebt(debtToEquity: number): number
```

**ETF handling**: Use a simplified scoring based on expense ratio and
tracking performance. Score = 0.0 + small adjustments.

**Crypto handling**: Return score = 0.0, confidence = 0.1, with
explanation = 'Fundamental metrics not applicable to crypto assets'.

**Confidence**: based on data freshness. Fundamental data older than 90
days → confidence = 0.3. Recent data → confidence up to 0.8.

---

### Agent 4 — Market Regime Agent

**File**: `/agents/regime/index.ts`

This agent runs ONCE per day (not per ticker). Its output is a single
score stored with ticker = 'MARKET' in agent_scores.

Reads from: `price_history` for SPY (S&P 500 proxy) and VIX-proxy calculation.

```typescript
interface RegimeOutput {
  regimeScore: number        // -1.0 to +1.0
  regimeLabel: MarketRegimeLabel
  volatilityLevel: 'low' | 'normal' | 'elevated' | 'extreme'
  broadTrend: 'strengthening' | 'stable' | 'weakening'
  sectorRotation: 'growth' | 'balanced' | 'defensive'
  regimeConfidence: number
}
```

**Regime scoring**:
```typescript
// SPY trend: price vs 50 EMA and 200 EMA
// VIX proxy: calculate 20-day realized volatility from SPY price changes
// Sector rotation: compare XLK vs XLV performance (growth vs defensive)

const regimeScore =
  (spyTrendScore * 0.50) +
  (volatilityScore * 0.30) +  // low vol → positive
  (sectorRotationScore * 0.20)
```

Label mapping:
- > +0.4 → 'bullish'
- +0.1 to +0.4 → 'neutral'
- -0.3 to +0.1 → 'cautious'
- < -0.3 → 'bearish'

---

## Part 2 — LLM Synthesis Agent

This is the heart of the product. Read `/docs/LLM_Synthesis_Agent_Spec.docx`
completely before building this.

### Context Builder
**File**: `/agents/synthesis/context-builder.ts`

Assembles the full context package for one user from the database.

```typescript
async function buildContextPackage(
  userId: string,
  portfolioId: string,
  date: Date
): Promise<SynthesisContextPackage>
```

This function:
1. Loads user_profiles for this user
2. Loads portfolio_positions with current valuations
3. Loads agent_scores for all current positions + top 5 scored non-owned assets
4. Loads today's market_regime score
5. Loads today's macro_events (last 24h)
6. Calculates goal_probability_trend (today vs 2 weeks ago)
7. Calculates concentration_risk from position weights
8. Assembles into `SynthesisContextPackage` type from shared/types/synthesis.ts
9. Writes the context package to `synthesis_inputs` table

Asset scope selection logic:
```typescript
// Always include: all current portfolio positions
// Always include: any position within 10% of drawdown limit
// Include: top 5 scoring assets NOT in portfolio (filtered by user's asset type prefs)
// Include: any asset with score delta > 0.3 since last run
// Typical total: 10-18 assets
```

### Prompt Builder
**File**: `/agents/synthesis/prompt-builder.ts`

```typescript
function buildSystemPrompt(): string
function buildUserPrompt(context: SynthesisContextPackage): string
```

**System prompt must include**:
- Identity: senior portfolio analyst, not a financial advisor
- The 6-step reasoning process (from the spec doc)
- Instruction to output ONLY valid JSON, no preamble, no markdown fencing
- The exact JSON schema expected (copy from spec)
- Instruction to include confidence scores and be honest about uncertainty

**User prompt**: Serialize the `SynthesisContextPackage` as clean, structured
text (not raw JSON — format it readably for the LLM):

```
PORTFOLIO GOAL
Target return: {goalReturnPct}% | Time remaining: {months} months
Current probability: {pct}% ({trend})

PORTFOLIO STATE
Total value: ${value} | Cash: {cashPct}%
Concentration risk: {risk}

CURRENT POSITIONS
{ticker} — {allocation}% — P&L: {pnl}% — {drawdownWarning if applicable}
  Technical: {score} ({confidence}) | Sentiment: {score} | Fundamental: {score}

MARKET REGIME
{regimeLabel} — Volatility: {level} — Trend: {broadTrend}
Regime confidence: {confidence}

MACRO EVENTS (last 24h)
- {eventDescription} [{sentiment}] → Relevant to: {relevantTickers}

NEW POSITION CANDIDATES
{ticker} — Combined score: {score} — {assetType}
  Technical: {score} | Sentiment: {score} | Fundamental: {score}
```

### LLM Caller
**File**: `/agents/synthesis/llm-caller.ts`

```typescript
async function callSynthesisLLM(
  systemPrompt: string,
  userPrompt: string,
  userId: string,
  runDate: Date
): Promise<{ output: SynthesisOutput, runId: string }>
```

Implementation:
```typescript
// 1. Create synthesis_runs record (start of run)
// 2. Call Anthropic API:
const response = await anthropic.messages.create({
  model: SYNTHESIS_MODEL,  // 'claude-sonnet-4-20250514'
  max_tokens: 1500,
  system: systemPrompt,
  messages: [{ role: 'user', content: userPrompt }]
})
// 3. Extract text content
// 4. Strip any accidental markdown fencing
// 5. Parse JSON — if parse fails, retry ONCE with format reminder
// 6. Validate against SynthesisOutput schema (Zod)
// 7. Update synthesis_runs with token counts + latency
// 8. If LLM call fails entirely: set fallback_used = true, return null
```

**On failure**: Return null. The rules engine handles the fallback case.

### Output Validator
**File**: `/agents/synthesis/output-validator.ts`

Use Zod to validate the LLM output schema.

```typescript
const SynthesisOutputSchema = z.object({
  weightRationale: z.object({
    technical: z.number().min(0).max(1),
    sentiment: z.number().min(0).max(1),
    fundamental: z.number().min(0).max(1),
    regime: z.number().min(0).max(1),
    reasoning: z.string()
  }),
  portfolioAssessment: z.object({
    goalStatus: z.enum(['on_track', 'monitor', 'at_risk', 'off_track']),
    primaryRisk: z.string(),
    assessment: z.string()
  }),
  recommendations: z.array(z.object({
    ticker: z.string(),
    action: z.enum(['BUY', 'SELL', 'REDUCE', 'ADD', 'HOLD']),
    urgency: z.enum(['high', 'medium', 'low']),
    allocationChangePct: z.number(),
    reasoning: z.string(),
    confidence: z.number().min(0).max(1)
  })),
  portfolioNarrative: z.string().max(1000),
  overallConfidence: z.number().min(0).max(1),
  lowConfidenceReasons: z.array(z.string())
})
```

### Rules Engine
**File**: `/agents/synthesis/rules-engine.ts`

Receives validated `SynthesisOutput`. Applies hard limits. Returns
modified output plus a log of any overrides applied.

```typescript
async function applyRulesEngine(
  output: SynthesisOutput,
  userProfile: UserProfile,
  portfolioState: PortfolioState
): Promise<{ validated: SynthesisOutput, overrides: RulesOverride[] }>
```

**Rules to implement** (from spec):

```typescript
// Rule 1: Max single position cap
// If any recommendation results in > 30% allocation → cap at 30%, log override

// Rule 2: Drawdown hard stop
// If any position is at or past user's max_drawdown_limit_pct
// → Force action: 'SELL', urgency: 'high', override LLM recommendation

// Rule 3: Max 3 changes per day
// If > 3 non-HOLD recommendations → keep top 3 by (urgency + confidence)

// Rule 4: Asset type constraint
// If recommendation is for asset type not in user's preferences → remove it

// Rule 5: Cash floor
// If total BUY recommendations would bring cash below 5% → remove lowest priority BUYs

// Rule 6: Crypto allocation cap
// If user has set a crypto max and recommendations exceed it → reduce proportionally
```

**Fallback behavior**: If LLM output was null (call failed):
```typescript
function generateFallbackRecommendations(
  agentScores: AgentScore[],
  userProfile: UserProfile
): SynthesisOutput {
  // Generate basic Hold/Buy/Sell signals from combined math scores
  // Use DEFAULT_AGENT_WEIGHTS from constants
  // Set overallConfidence = 0.3, narrative = "Low conviction today —
  //   recommendations based on quantitative signals only."
}
```

### Daily Runner
**File**: `/agents/runner/daily-runner.ts`

Orchestrates the full analysis cycle for a given date:

```typescript
async function runDailyAnalysis(date: Date) {
  console.log(`[Agents] Starting daily analysis for ${date.toISOString()}`)

  // Step 1: Run math agents on all 100 assets
  // Run Technical, Fundamental, Regime synchronously (deterministic, no API calls)
  // Run Sentiment in batches of 10 (has LLM calls — respect rate limits)

  const tickers = ASSET_UNIVERSE.map(a => a.ticker)

  await Promise.all([
    technicalAgent.runBatch(tickers, date),
    fundamentalAgent.runBatch(tickers, date),
  ])
  await regimeAgent.run(date)  // once, not per ticker
  await sentimentAgent.runBatch(tickers, date)  // batched

  // Step 2: Run synthesis for each active user portfolio
  const activePortfolios = await getActivePortfolios()
  for (const portfolio of activePortfolios) {
    await runSynthesisForPortfolio(portfolio.id, portfolio.userId, date)
  }

  console.log(`[Agents] Daily analysis complete`)
}
```

---

## Important Implementation Notes

**Scoring agents are pure functions at heart.** The database I/O is a
thin wrapper around deterministic math. Keep the calculation logic
separate from the DB read/write logic so it's testable.

**The Synthesis Agent is NOT a pure function.** It is stateful (reads from
DB, writes audit logs) and non-deterministic (LLM). Handle it accordingly.

**Token budget per synthesis run**: ~1,500 input + 600 output = ~2,100 tokens.
At Sonnet pricing this is very affordable per user per day.

**Store component scores in full.** The `component_scores` jsonb field in
`agent_scores` should contain every indicator's raw value and contribution
score. This data is shown in the Reasoning Depth modal on the frontend.

---

## Definition of Done

- [ ] All 4 math agents compile and produce scores in [-1.0, +1.0]
- [ ] Sentiment agent calls Anthropic API and handles failures gracefully
- [ ] Context builder correctly assembles SynthesisContextPackage
- [ ] Prompt builder produces clean, readable prompts
- [ ] LLM caller handles JSON parse failures with one retry
- [ ] Output validator catches schema violations
- [ ] Rules engine applies all 6 rules and logs overrides
- [ ] Fallback path works when LLM call fails
- [ ] Daily runner orchestrates everything in correct order
- [ ] All synthesis outputs are written to audit tables
- [ ] AGENT_NOTES_ANALYSIS.md written: output schemas, what the Frontend
      agent needs to read from which tables, any assumptions about data
      availability
