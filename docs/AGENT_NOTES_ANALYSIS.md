# Analysis Engine Agent Notes

## Files Created

### Math Scoring Agents
| File | Purpose |
|---|---|
| `agents/technical/index.ts` | RSI, MACD, EMA, Bollinger Bands, Volume signals → weighted technical score |
| `agents/sentiment/index.ts` | LLM-based news sentiment via Claude Haiku, with decay for stale news |
| `agents/fundamental/index.ts` | P/E, revenue growth, margin, ROE, debt scoring (crypto returns neutral) |
| `agents/regime/index.ts` | SPY trend + realized volatility + sector rotation → single MARKET score |

### LLM Synthesis Agent
| File | Purpose |
|---|---|
| `agents/synthesis/context-builder.ts` | Assembles SynthesisContextPackage from DB for one user |
| `agents/synthesis/prompt-builder.ts` | System prompt (6-step reasoning) + user prompt (structured context) |
| `agents/synthesis/llm-caller.ts` | Anthropic API call with JSON retry and audit logging |
| `agents/synthesis/output-validator.ts` | Zod schema validation of LLM output |
| `agents/synthesis/rules-engine.ts` | 6 hard rules + fallback recommendation generator |
| `agents/synthesis/narrative-formatter.ts` | Trims narrative to 3 paragraphs / 1000 chars |
| `agents/synthesis/index.ts` | Orchestrates context → prompt → LLM → rules → DB writes |

### Runner
| File | Purpose |
|---|---|
| `agents/runner/daily-runner.ts` | Orchestrates full daily cycle: tech+fund parallel → regime → sentiment → synthesis per user |
| `agents/runner/index.ts` | Re-export |

### Config
| File | Purpose |
|---|---|
| `agents/tsconfig.json` | TypeScript config extending root conventions, includes shared/ |

## Output Schemas

### agent_scores (written by all 4 math agents)
All scores: `[-1.0, +1.0]`, confidence: `[0.0, 1.0]`
- `ticker`, `date`, `agent_type`, `score`, `confidence`, `component_scores` (jsonb), `explanation`, `data_freshness`, `agent_version`
- Upsert on `(ticker, date, agent_type)`
- Regime agent uses ticker = `'MARKET'`

### synthesis_inputs (written by context-builder)
- `user_id`, `run_date`, `context_package` (full jsonb), `asset_scope` (text[])

### synthesis_runs (written by llm-caller)
- `user_id`, `run_date`, `model_used`, `input_tokens` (int), `output_tokens` (int), `latency_ms` (int), `llm_call_succeeded` (bool), `fallback_used` (bool)

### synthesis_raw_outputs (written by llm-caller, updated by synthesis/index)
- `synthesis_run_id`, `raw_llm_output` (jsonb), `post_rules_output` (jsonb), `overrides_applied` (jsonb), `low_confidence_reasons` (text[]), `created_at`

### recommendation_runs (written by synthesis/index)
- `portfolio_id`, `run_date`, `synthesis_run_id`, `overall_confidence`, `goal_status`, `portfolio_narrative`, `weight_rationale` (jsonb)

### recommendation_items (written by synthesis/index)
- `run_id`, `ticker`, `action`, `urgency`, `current_allocation_pct`, `target_allocation_pct`, `llm_reasoning`, `confidence`, `rules_engine_applied`, `rules_engine_note`, `priority`

## What the Frontend Agent Needs

The frontend reads (all read-only via Supabase client):

| Table | What to show |
|---|---|
| `recommendation_runs` | Daily briefing card: `portfolio_narrative`, `goal_status`, `overall_confidence`, `weight_rationale` |
| `recommendation_items` | Recommendation cards: `ticker`, `action`, `urgency`, `confidence`, `llm_reasoning`, `rules_engine_note` |
| `agent_scores` | Reasoning Depth modal: `component_scores` jsonb for each agent per ticker |
| `synthesis_raw_outputs` | Audit/debug view: `raw_llm_output`, `overrides_applied` |
| `portfolio_valuations` | Goal probability chart, total value display |
| `portfolio_risk_metrics` | Risk indicators: `concentration_risk`, `max_drawdown_pct`, `diversification_score` |

## Assumptions

1. **Sentiment model**: Uses `claude-haiku-4-5-20251001` for per-ticker sentiment (cheap, fast). Synthesis uses `SYNTHESIS_MODEL` from constants (`claude-opus-4-6`).
2. **Upsert strategy**: agent_scores uses upsert on `(ticker, date, agent_type)` — assumes a unique constraint exists on that triple in the DB.
3. **Price for P&L**: Current price for position P&L comes from latest `price_history` row, not `market_quotes`.
4. **Concentration risk**: Calculated as scaled HHI (Herfindahl-Hirschman Index) of position allocations.
5. **Goal probability trend**: Compares current vs 14-days-ago `goal_probability_pct` from `portfolio_valuations`.
6. **Asset scope**: Includes all positions + top 5 non-owned by technical score + any with >0.3 delta. Typically 10-18 assets.
7. **Sector median P/E**: Hardcoded for MVP. Should be updated with live data post-MVP.
8. **ETF fundamentals**: Returns neutral score (0.0) with low confidence (0.3). Simplified for MVP.

## Status

- [x] Technical Analysis Agent — complete, all 5 indicators + weighted scoring
- [x] Sentiment Analysis Agent — complete, LLM call + decay + fallback
- [x] Fundamental Analysis Agent — complete, 5 metrics + crypto/ETF handling
- [x] Market Regime Agent — complete, SPY trend + vol + sector rotation
- [x] Context Builder — complete, assembles full SynthesisContextPackage
- [x] Prompt Builder — complete, 6-step reasoning system prompt
- [x] LLM Caller — complete, retry on JSON failure, audit logging
- [x] Output Validator — complete, Zod schema validation
- [x] Rules Engine — complete, all 6 rules + fallback generator
- [x] Narrative Formatter — complete, trims to spec
- [x] Synthesis Orchestrator — complete, full pipeline with DB writes
- [x] Daily Runner — complete, correct execution order
- [x] TypeScript compiles with no errors
