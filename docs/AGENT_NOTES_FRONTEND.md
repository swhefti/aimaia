# Frontend Agent Notes

## Status

### Complete
- [x] **Task 1 — App Structure & Auth**: Root layout with Inter font, AuthProvider, login/signup pages, supabase-browser client, queries.ts, formatters.ts
- [x] **Task 2 — Onboarding Wizard**: 5-step wizard (capital, horizon, asset types, diversification, goal & risk), writes to user_profiles, calls /api/portfolio/initialize
- [x] **Task 3 — Portfolio Creation**: Polls /api/portfolio/recommendations, shows recommendation cards, approve/dismiss, creates portfolio on confirm
- [x] **Task 4 — Dashboard**: All 5 sections (Daily Briefing, Goal Tracker, Portfolio Overview with Recharts chart, Recommendations, Positions table with expandable agent scores, Opportunities)
- [x] **Task 5 — Reasoning Depth Modal**: Full 3-layer explanation (reasoning, evidence/agent scores, weight adjustment, context)
- [x] **Task 6 — API Routes**: 4 routes (initialize, recommendations, decision, valuations)
- [x] **Task 7 — UI Components**: Button, Card, Badge (Signal/Confidence/Urgency/AssetType), ScoreBar, GoalProgressBar, Spinner, Modal, Tooltip
- [x] **TypeScript**: Compiles with zero errors (`npx tsc --noEmit`)
- [x] **Responsive**: All layouts use Tailwind responsive classes, cards stack vertically on mobile

### Known Gaps / Stubbed
- Portfolio creation page assigns `quantity: 0` and `avgPurchasePrice: 0` to positions — backend should calculate actual quantities based on allocation %
- `/api/portfolio/initialize` inserts a `synthesis_runs` row with `status: 'pending'` — the pipeline agent needs to pick this up
- Real-time subscription on `recommendation_runs` table requires Supabase Realtime to be enabled for that table
- No `next/font/google` runtime — Inter font loads at build time via Next.js font optimization

## API Contract Assumptions

### Database column names (snake_case)
All queries use snake_case column names from Supabase, mapped to camelCase TypeScript types:
- `user_profiles`: user_id, investment_capital, time_horizon_months, risk_profile, goal_return_pct, max_drawdown_limit_pct, volatility_tolerance, asset_types, max_positions
- `portfolios`: id, user_id, name, created_at, status
- `portfolio_positions`: id, portfolio_id, ticker, quantity, avg_purchase_price, opened_at
- `portfolio_valuations`: portfolio_id, date, total_value, cash_value, daily_pnl, cumulative_return_pct, goal_probability_pct
- `recommendation_runs`: id, portfolio_id, run_date, synthesis_run_id, overall_confidence, goal_status, portfolio_narrative, weight_rationale, generated_at
- `recommendation_items`: id, run_id, ticker, action, urgency, current_allocation_pct, target_allocation_pct, llm_reasoning, confidence, rules_engine_applied, rules_engine_note, priority
- `user_decisions`: id, recommendation_id, decision, decided_at
- `agent_scores`: ticker, date, agent_type, score, confidence, component_scores, explanation, data_freshness, agent_version
- `synthesis_raw_outputs`: id, synthesis_run_id, raw_llm_output, post_rules_output, overrides_applied, low_confidence_reasons, created_at
- `synthesis_runs`: id, user_id, run_date, model_used, input_tokens, output_tokens, latency_ms, llm_call_succeeded, fallback_used, created_at

### `weight_rationale` stored as JSONB
The `recommendation_runs.weight_rationale` column is expected to be a JSONB column with shape: `{ technical: number, sentiment: number, fundamental: number, regime: number, reasoning: string }`

### Auth
Uses `@supabase/auth-helpers-nextjs`:
- `createClientComponentClient()` for browser-side
- `createRouteHandlerClient({ cookies })` for API routes

## File Inventory

```
frontend/
  postcss.config.js
  app/
    globals.css
    layout.tsx                      — root layout, Inter font, AuthProvider
    page.tsx                        — redirect to /dashboard or /login
    (auth)/login/page.tsx           — email+password login
    (auth)/signup/page.tsx          — email+password signup
    onboarding/page.tsx             — 5-step wizard
    portfolio/create/page.tsx       — first portfolio creation
    dashboard/page.tsx              — main daily view (5 sections)
    api/portfolio/
      initialize/route.ts           — POST, triggers analysis
      recommendations/route.ts      — GET, latest recommendations
      decision/route.ts             — POST, approve/dismiss
      valuations/route.ts           — GET, portfolio value history
  components/
    auth-provider.tsx               — Supabase auth context
    ui/
      button.tsx, card.tsx, badge.tsx, score-bar.tsx,
      goal-progress-bar.tsx, spinner.tsx, modal.tsx, tooltip.tsx
    dashboard/
      daily-briefing.tsx, goal-tracker.tsx, portfolio-overview.tsx,
      positions-table.tsx
    portfolio/
      recommendation-card.tsx, reasoning-modal.tsx
  lib/
    supabase-browser.ts             — browser Supabase client
    queries.ts                      — typed DB query functions
    formatters.ts                   — number/date/score formatting
```
