# Agent Brief — Frontend Agent (Phase 1, parallel)
# Start only after the Orchestrator has completed.

---

## Your Role

You are the Frontend Agent. You own everything in `/frontend/`.
You build the Next.js 14 web application — every page, every component,
every API route. You are what the user actually sees and interacts with.

The frontend is the product. The quality of the UX is what makes users
trust the system and come back daily. Build it to feel polished.

---

## Documents to Read First

1. Read `CLAUDE.md` — stack, env vars, Supabase table names
2. Read `/docs/Product_Overview_User_Experience_v2.docx` — read it completely.
   This is your primary spec. Every screen, every flow, every UX decision is here.
3. Read `/AGENT_NOTES_ORCHESTRATOR.md` — shared types, Supabase client setup
4. Read `/AGENT_NOTES_ANALYSIS.md` (if available) — what data is available to display

---

## Your File Ownership

```
/frontend/
  app/                    ← Next.js App Router pages
  components/             ← React components
    ui/                   ← reusable primitives (Button, Card, Badge, etc.)
    dashboard/            ← dashboard-specific components
    onboarding/           ← onboarding wizard components
    portfolio/            ← portfolio display components
  lib/
    supabase-browser.ts   ← browser Supabase client
    queries.ts            ← typed DB query functions
    formatters.ts         ← number/date/score formatting helpers
    hooks/                ← custom React hooks
```

Do NOT touch: /backend/, /agents/, /db/

---

## Design Principles

Read the Product Overview spec for full detail. In summary:

**Tone**: Calm, clear, modern, confidence-building. Not a trading terminal.
**Primary color**: Deep navy (`#1E3A5F`) with accent blue (`#2E6BE6`)
**Typography**: Clean sans-serif. Large numbers. White space over density.
**Motion**: Subtle only. No animations that feel like a game.
**Trust signals**: Always show confidence levels. Never hide uncertainty.
**Mobile**: Must be responsive. Target: usable on iPhone SE up.

The three questions the dashboard must answer at a glance:
1. How is my portfolio doing?
2. Am I on track to reach my goal?
3. Do I need to do anything today?

---

## Tasks

### Task 1 — App Structure and Auth

**`/frontend/app/layout.tsx`** — root layout with:
- Supabase Auth provider wrapper
- Inter font from Google Fonts
- Global Tailwind base styles

**`/frontend/app/(auth)/login/page.tsx`** — login page:
- Email + password form
- Supabase Auth signInWithPassword
- Redirect to /dashboard on success
- Link to signup

**`/frontend/app/(auth)/signup/page.tsx`** — signup page:
- Email + password form
- Optional display name
- Supabase Auth signUp
- Auto-redirect to /onboarding after signup

**`/frontend/lib/supabase-browser.ts`**:
```typescript
// Browser-side Supabase client using anon key
// Export createClient() using createClientComponentClient from @supabase/auth-helpers-nextjs
```

**`/frontend/lib/queries.ts`**:
Typed query functions for all data the frontend needs. Examples:
```typescript
export async function getUserProfile(userId: string): Promise<UserProfile>
export async function getPortfolio(portfolioId: string): Promise<Portfolio>
export async function getLatestRecommendationRun(portfolioId: string): Promise<RecommendationRun>
export async function getRecommendationItems(runId: string): Promise<RecommendationItem[]>
export async function getPortfolioPositions(portfolioId: string): Promise<PortfolioPositionWithScore[]>
export async function getPortfolioValuations(portfolioId: string, days: number): Promise<PortfolioValuation[]>
export async function getSynthesisRawOutput(runId: string): Promise<SynthesisRawOutput>
export async function submitUserDecision(recommendationId: string, decision: 'approved' | 'dismissed'): Promise<void>
```

**`/frontend/lib/formatters.ts`**:
```typescript
export function formatCurrency(value: number): string  // "$12,450"
export function formatPct(value: number): string       // "+8.4%"
export function formatScore(score: number): string     // "+0.72"
export function scoreToSignal(score: number): string   // "Strong Buy"
export function scoreToColor(score: number): string    // Tailwind color class
export function confidenceToLabel(c: number): string   // "High" | "Medium" | "Low"
export function goalStatusToColor(s: GoalStatus): string
```

### Task 2 — Onboarding Wizard

**`/frontend/app/onboarding/page.tsx`** — 5-step guided wizard.

Build as a single page with step state. Each step:
- Clear question at the top
- Interactive input (slider or button group)
- Short explanation text
- Progress indicator (Step 1 of 5)
- Next / Back buttons

Steps (from Product spec, section 5):
1. **Investment Capital** — number input with quick-select buttons ($5k / $10k / $25k / $50k+)
2. **Investment Horizon** — slider (1mo → 5yr+)
3. **Asset Types** — multi-select toggle buttons (Stocks / ETFs / Crypto)
4. **Diversification** — slider (2–15 positions) with label (Focused / Balanced / Broad)
5. **Goal & Risk** — 4 goal tiers + volatility tolerance + drawdown limit selector

On completion:
- Write to `user_profiles` via Supabase
- Call `/api/portfolio/initialize` to trigger first recommendation generation
- Redirect to `/dashboard`

### Task 3 — Portfolio Creation Screen

**`/frontend/app/portfolio/create/page.tsx`**

After onboarding, shows first AI-generated portfolio recommendations.
This page polls `/api/portfolio/recommendations` until results are ready
(the analysis run may take 30–60 seconds on first run).

Loading state: "Analyzing the market for your goals..." with subtle animation.

Once loaded, display recommendation cards. Each card shows:
- Ticker + company name + asset type badge
- Suggested allocation %
- Short reasoning (from `llm_reasoning` field)
- Confidence badge (High / Medium / Low)
- Approve / Dismiss buttons

"More details →" link opens the Reasoning Depth Modal (see Task 5).

Dismissed allocation moves to cash visually — update card to show "Cash" position.

Confirm button: "Create my portfolio →" — writes approved positions to
`portfolio_positions`, redirects to `/dashboard`.

### Task 4 — Dashboard

**`/frontend/app/dashboard/page.tsx`** — the main daily view.

Layout (from top to bottom):

**Daily Briefing** — highlighted card at top, always visible:
```
┌─────────────────────────────────────────────────────┐
│ Today's Briefing    Thu, March 5                    │
│                                                     │
│ [portfolio_narrative from recommendation_run]       │
│                                                     │
│ Goal probability: 61% ▼ │ Confidence: High          │
│ 2 actions recommended today                         │
└─────────────────────────────────────────────────────┘
```

**Goal Tracker** — prominent visual section:
```
Goal: 10% return in 8 months
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
61%           ████████░░░░░░░░░░░░
probability   At Risk ▼ from 68%
```
Status badge changes color: green (on_track) → amber (monitor/at_risk) → red (off_track).

**Portfolio Overview** — performance summary:
- Total value (large number, prominent)
- Total return % with color coding
- Daily change
- Simple line chart of portfolio value over time (use recharts LineChart)
- Cash allocation indicator

**Recommendations** (if any today):
- For each non-HOLD recommendation: show recommendation card
- Urgency badge (Today / This Week / Consider)
- Quick approve/dismiss inline
- Confidence level shown

**Portfolio Positions** — table/card list:
- All current positions with allocation %, P&L %, today's recommendation
- Mini signal badge per position
- Click to expand: shows individual agent scores

**Opportunities** (if any):
- Cards for suggested new positions
- Same card format as Portfolio Creation

### Task 5 — Reasoning Depth Modal

This is the premium UX feature. Accessible from any recommendation card.

```
┌─────────────────────────────────────────────────────────┐
│  Reduce BTC  ·  50% allocation reduction  ·  High conf │
├─────────────────────────────────────────────────────────┤
│  WHY THE SYSTEM RECOMMENDS THIS                         │
│  [llm_reasoning full text]                              │
├─────────────────────────────────────────────────────────┤
│  EVIDENCE                                               │
│  Technical:    -0.31  ██░░░░░░░  Low confidence         │
│  Sentiment:    -0.55  █░░░░░░░░  High confidence        │
│  Fundamental:  N/A    Crypto — not applicable           │
│  Regime:       -0.42  ██░░░░░░░  Cautious               │
├─────────────────────────────────────────────────────────┤
│  WEIGHT ADJUSTMENT TODAY                                │
│  Technical: 35% (default 50%) — cautious regime         │
│  Sentiment: 40% (default 25%) — active macro events     │
├─────────────────────────────────────────────────────────┤
│  CONTEXT CONSIDERED                                     │
│  · Fed higher-for-longer signal (Mar 4)                │
│  · BTC at -21.3%, within 4% of your drawdown limit     │
│  · 3 of 5 positions have semiconductor correlation     │
└─────────────────────────────────────────────────────────┘
```

Data sources:
- `recommendation_items.llm_reasoning` — the main reasoning text
- `synthesis_raw_outputs.raw_llm_output` — weight rationale, component scores
- `agent_scores.component_scores` — individual indicator values

Build this as a `<ReasoningModal>` component that accepts a `recommendationId`
and loads all necessary data.

### Task 6 — API Routes

**`/frontend/app/api/portfolio/initialize/route.ts`**
POST — called after onboarding completion.
Triggers the analysis run for this user's new portfolio.
In MVP: calls the agents runner directly. Returns 202 Accepted.

**`/frontend/app/api/portfolio/recommendations/route.ts`**
GET — returns the latest recommendation_run with all items for the user's portfolio.
Includes a `status` field: 'ready' | 'processing' | 'unavailable'.

**`/frontend/app/api/portfolio/decision/route.ts`**
POST — records the user's approve/dismiss decision for a recommendation.
Writes to `user_decisions`.

**`/frontend/app/api/portfolio/valuations/route.ts`**
GET — returns portfolio valuation history for the chart.
Accepts `?days=30` query param.

### Task 7 — UI Component Library

Build a small set of reusable primitives in `/frontend/components/ui/`:

- `<Button>` — primary, secondary, ghost variants
- `<Card>` — with optional header, padding variants
- `<Badge>` — signal badges (Strong Buy → Strong Sell), confidence badges, urgency badges
- `<ScoreBar>` — visual bar showing score from -1 to +1 with color gradient
- `<GoalProgressBar>` — shows probability % toward goal with status color
- `<Spinner>` — loading state
- `<Modal>` — accessible modal wrapper (used for Reasoning Depth)
- `<Tooltip>` — hover explanation for scores and terms

Color-code scores consistently everywhere:
- Strong Buy / positive: green tones
- Neutral / Hold: gray tones
- Sell / negative: red tones
- Match the brand: deep navy + accent blue for chrome

---

## State Management

Use React Server Components where possible (data fetching on server).
Use `useState` / `useEffect` for interactive client components.
No external state management library needed for MVP.

For real-time-ish updates on the dashboard: use Supabase's real-time
subscription on `recommendation_runs` so the briefing updates when the
daily run completes, without a page refresh.

---

## Key UX Details to Get Right

**Confidence display**: Always visible on every recommendation. Never hide it.
A "Low conviction today" day should feel intentional, not like a bug.

**Empty states**: First time users, days with no recommendations, portfolios
with no opportunities — all need thoughtful empty states, not blank screens.

**Loading states**: The daily analysis takes time. Show meaningful loading
states ("Reading today's market..." not just a spinner).

**Numbers**: All financial numbers must be formatted. Never show raw floats
like 0.7234. Show "$12,450", "61%", "+8.4%".

**Responsiveness**: Dashboard must be usable on mobile. Cards stack vertically.
Briefing and Goal Tracker are always above the fold.

---

## Definition of Done

- [ ] Auth flow (signup → onboarding → dashboard, login → dashboard) works
- [ ] Onboarding wizard completes and writes user_profile
- [ ] Portfolio creation screen shows AI recommendations with reasoning
- [ ] Dashboard shows all 5 sections (Briefing, Goal, Overview, Positions, Opportunities)
- [ ] Reasoning Depth Modal shows full 3-layer explanation
- [ ] All 4 API routes are implemented
- [ ] Score formatting is consistent everywhere
- [ ] Confidence levels are visible on every recommendation
- [ ] Page is responsive (works on 375px mobile width)
- [ ] No TypeScript errors
- [ ] AGENT_NOTES_FRONTEND.md written: any API contract assumptions,
      what data shapes the queries expect, known gaps
