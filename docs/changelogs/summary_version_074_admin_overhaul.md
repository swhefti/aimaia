# Version 0.74 — Admin Config Overhaul

## Summary

Overhauled the admin configuration system so settings reflect the actual live optimizer-first architecture. Dead/legacy settings are classified, missing optimizer/calibration controls are added, the synthesis explainer prompt is now editable, and config cache uses a TTL.

## Key Changes

### 1. Config Manifest (`shared/lib/admin-config-manifest.ts`)
Single source of truth for all admin settings. Each key has: label, description, type, group, runtime status (live/legacy/dead/manual_only), consumers, validation ranges, and warnings.

### 2. Dead/Legacy Keys Classified
| Key | Status | Reason |
|-----|--------|--------|
| `prompt_synthesis_system` | legacy | Superseded by `prompt_optimizer_explainer` |
| `max_chars_synthesis_narrative` | legacy | Not read by active optimizer-first job |
| `technical_lookback_days` | dead | Hardcoded in scores.ts |
| `technical_min_rows_confidence_*` | dead | Hardcoded in scores.ts |
| `prob_sigmoid_*`, `prob_*_bonus_*`, `prob_no_positions_cap` | dead | Heuristic probability uses hardcoded values in optimizer-core.ts |

### 3. New Config Keys Added (Migration 030)
**Optimizer:** `optimizer_cash_floor_pct`, `optimizer_max_position_pct`, `optimizer_max_crypto_pct`, `optimizer_max_daily_changes`, `optimizer_base_return_scale`, `optimizer_default_correlation`, `optimizer_correlation_shrinkage`, `optimizer_min_trade_pct`, `optimizer_friction_per_trade`, `optimizer_max_cluster_pct`

**Calibration:** `calibration_live_enabled`, `calibration_min_samples`, `calibration_preferred_30d_samples`, `calibration_7d_only_weight`, `calibration_max_age_days`

**Briefing:** `prompt_optimizer_explainer` (replaces legacy synthesis prompt)

### 4. Synthesis Explainer Prompt Wired to Config
The active `backend/jobs/synthesis.ts` now reads `prompt_optimizer_explainer` from `system_config`. Admin edits take effect on the next daily run. Fallback to hardcoded default if config is empty.

### 5. Config Cache with TTL
Both `frontend/lib/config.ts` (5-min TTL) and `backend/jobs/lib/config.ts` (10-min TTL) now expire cached values instead of caching forever. Admin changes propagate within minutes.

### 6. Admin UI Improvements
- Groups rendered from manifest (not hardcoded array)
- Status badges on settings: LIVE (green), LEGACY (gray), DEAD (red), MANUAL_ONLY (amber)
- Warning text on legacy/dead keys
- Diagrams moved to separate "Documentation" navigation section
- Weight-sum validation preserved and wired to manifest

### 7. Admin Navigation Structure
**Config groups:** Sentiment Agent, Technical Sub-Weights, Fundamental Sub-Weights, Conclusion Agent, Daily Brief / Explanations, Optimizer Constraints, Calibration Rollout, AI Probability, Risk Report, Composite Weights, Legacy / Manual Only

**Documentation:** Data Flow Diagram, Optimizer & Calibrator, Recommendations & Risk

## Files Changed

**New:**
- `shared/lib/admin-config-manifest.ts`
- `db/migrations/030_seed_optimizer_calibration_config.sql`
- `docs/changelogs/summary_version_074_admin_overhaul.md`

**Modified:**
- `frontend/app/admin/dashboard/page.tsx` — manifest-driven rendering, status badges, separated nav
- `backend/jobs/synthesis.ts` — reads `prompt_optimizer_explainer` from config
- `frontend/lib/config.ts` — 5-minute TTL cache
- `backend/jobs/lib/config.ts` — 10-minute TTL cache

## Verification

| Check | Result |
|---|---|
| Frontend typecheck | PASS |
| Backend typecheck | PASS (pre-existing only) |
| Agents typecheck | PASS |

## Residual / Next Steps
1. Run migration 030 in Supabase SQL Editor
2. Wire optimizer constraint configs to runtime (currently seeded but read from constants.ts — future task)
3. Wire calibration configs to runtime (currently seeded but read from calibration-config.ts — future task)
4. AI Probability `prob_*` keys remain dead; consider removing from DB or rewiring
