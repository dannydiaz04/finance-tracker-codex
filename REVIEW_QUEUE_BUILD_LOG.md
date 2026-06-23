# Build Log — Editable Review Queue → Overrides, Rules & Warehouse Safety

Companion to `PLAN.md` (the plan) and `REVIEW_QUEUE_EDITING_DESIGN_DEBATE.md` (the
A/B/C design debate). This log records **what was built, why, and how it was verified**,
phase by phase.

---

## Part 1 — Completed work (Phases 0–3)

### Phase 0 — Warehouse correctness & safety (Dataform SQLX)
**Files:** `dataform/definitions/core/fact_classification.sqlx`,
`dataform/definitions/ops/review_queue.sqlx`.

- **Deterministic rule ranking.** `matched_rules` now orders by
  `priority desc, created_at desc, rule_id` (was `priority desc` only). Every learned
  rule is `priority 110`, so an unbroken tie let BigQuery pick the winning category
  non-deterministically — categories could flip run-to-run. *(Agent C blocker C3.1.)*
- **Rule-disable actually works.** A new `active_rules` CTE collapses `category_rules`
  to the latest row per `(user_id, rule_id)` and keeps only `coalesce(enabled, true)`,
  so a disabled tombstone supersedes the original.
- **No LIKE injection.** `merchant_contains` uses
  `strpos(lower(merchant_norm), lower(match_value)) > 0` (was unescaped `LIKE`), so
  `%`/`_` can't widen a match; it also matches the JS classifier's `.includes()`.
- **Honest resolution.** `review_queue` left-anti-joins `manual_overrides`, so any
  overridden transaction leaves the queue immediately (the view reads the live
  operational table — no `dataform run` needed). It also now projects
  `current_category_id` and `merchant_norm`.
- **Override tiebreaker.** The override CTE orders by `updated_at desc, category_id desc`
  (defensive against same-millisecond writes).

**Verified:** `npm run dataform:compile` ✓.

### Phase 1 — Pure orchestrator (`lib/categorization/override-plan.ts`)
The single, unit-tested chokepoint every rule write flows through:
`resolveRuleAction` (3-way + legacy back-compat), `applyRuleGuardrails`
(short-token/aggregator → `merchant_exact`, `%`/`_` stripped, regex validated),
`dedupePlan` (key = `(user, normalized match_value)` **without** category_id → conflicts
caught), `buildCategoryRuleRow`, `computeMatchPreview`, and `planOverride` — including
the **anti-rubber-stamp guard** (confirming the current category learns nothing).

**Verified:** 25 unit tests in `tests/categorization/override-plan.test.mjs`; the
`npm test` aggregate switched to a recursive glob so new dirs aren't orphaned.

### Phase 2 — Routes (thin adapters over Phase 1)
- **`/api/categories/override`** — `ruleAction` (+ legacy `createRuleSuggestion`),
  `dryRun` with a **user-scoped match-count using the warehouse's exact predicate**,
  **category-id validation** (400 on unknown — no unvalidated id pinned at conf 1.00),
  contradictory-rule **supersede** (disabled tombstone), stale-pending-suggestion
  supersede, and **deterministic suggestion/rule ids** so retries collide.
- **`/api/rules`** — guardrails on POST, real category lookup (was sample data), and a
  new **`DELETE`** that disables a rule (the previously-missing rollback path).
- **`/api/rule-suggestions/[id]` accept** — dedupe/guardrails/supersede moved to the
  **real `category_rules` write** (where the duplicate-rule footgun actually lived);
  idempotent on `rule_id`.

**Verified:** typecheck ✓, lint ✓, **build ✓**, 97 tests ✓.

### Phase 3 — Data threading
`ReviewQueueItem` += `currentCategoryId` / `merchantNorm`; both review-queue queries
(`getLowConfidenceReviewItems`, `getReviewQueue`) select the new columns; sample data
updated. **Verified:** typecheck ✓, 72 tests ✓.

### Deliberate deviations from the consensus design
- **RowWriter route seam (D5) dropped** — routes aren't importable under `node --test`
  (`next/server` + `@/` alias + top-level DB init), so the pure `override-plan` helper
  *is* the tested seam; a route-level writer seam buys no real coverage.
- **`suggestedCategoryId` → `currentCategoryId`** on the review item — the form needs
  the *current* derived category for the anti-rubber-stamp no-op guard, not an id for
  the AI's suggested label (which stays a read-only hint).

---

## Part 2 — Work about to build (Phase 4 — UI)

**Goal:** make the static review-queue cards editable, reusing one override surface
across the transaction drawer and the review queue, without forking logic.

**New / changed files:**
1. `lib/categorization/override-form-state.ts` *(new, pure + unit-tested)* — UI decision
   logic kept out of the React component so it's testable under `node --test`:
   `resolveDefaultCategoryId` (never pre-selects the AI label),
   `describeSaveResult` (success / partial-failure / sample-local / error tone +
   message from the route response), `describePreview` (preview + match-count +
   conflict/guardrail text from the `dryRun` response).
2. `components/transactions/override-form.tsx` *(new, client component)* — the shared
   form: native `<Select>` (iOS-friendly), optional note `<Input>`, a 3-way learning
   action (`suggest` default / `create` / `none`), a **debounced `dryRun` preview**, an
   `isSaving` guard, and a persisted/partial-failure-aware result line. `variant:
   "drawer" | "inline"` controls layout only; logic is shared. Posts to the existing
   `/api/categories/override` (the repo's client-fetch-to-route-handler idiom, per the
   Next 16 `use client` / mutating-data docs). **Does not pre-select the AI suggestion**
   and suppresses learning when the category is unchanged.
3. `components/transactions/transaction-drawer.tsx` *(refactor)* — replace the inline
   `<form>` with `<OverrideForm variant="drawer" … onResolved={() => router.refresh()} />`;
   drop the now-duplicated save state. Behavior preserved.
4. `components/rules/review-queue-card.tsx` *(new, client component)* — a dense card
   wrapping `<OverrideForm variant="inline" />`; on a persisted save it optimistically
   shows a "resolved" state (honest about sample vs warehouse), backed on configured
   deployments by the Phase-0 view exclusion.
5. `app/(dashboard)/rules/page.tsx` & `app/(dashboard)/categories/page.tsx` *(wire-in)* —
   fetch `getCategories()` (as `categoryOptions` to avoid the existing `categories`
   binding) and render `ReviewQueueCard` in place of the static review divs.

**Testing plan (Phase 5):** unit tests for the new pure helpers; `typecheck` + `lint` +
`build` for the components (they can't be imported under `node --test` — same Next/alias
constraint as routes, so compile-level + extracted-logic coverage is the right line);
plus `dataform:compile` and a runtime smoke check. A11y: `aria-label`s on the dense
inline controls; the native `<select>` keeps the iOS picker.

---

## Part 3 — Completion & verification

### Phase 4 — what shipped
- **`lib/categorization/override-form-state.ts`** *(new, pure)* — `resolveDefaultCategoryId`
  (defaults to the current derived category, never the AI label, never `option[0]`),
  `describeSaveResult` (success / partial-failure / sample-local / error tone+message),
  `describePreview` (preview + blast-radius count + conflict/guardrail text). **13 unit tests.**
- **`components/transactions/override-form.tsx`** *(new, client)* — the one shared form:
  native `<Select>` category, optional note `<Input>`, 3-way learning action (`suggest`
  default), **debounced server `dryRun` preview keyed to (category, action)** so a stale
  preview is never shown, `isSaving` guard, and a tone-aware result line. `variant:
  "drawer" | "inline"` is layout-only. Does **not** pre-select the AI suggestion; suppresses
  learning when the category is unchanged. `aria-label`s on all controls.
- **`components/transactions/transaction-drawer.tsx`** *(refactor)* — inline `<form>`
  replaced by `<OverrideForm variant="drawer" onResolved={() => router.refresh()} />`; the
  duplicated save-state/handler removed. Behavior preserved (and improved: an unchanged
  category no longer spawns a noise suggestion).
- **`components/rules/review-queue-card.tsx`** *(new, client)* — dense card wrapping
  `<OverrideForm variant="inline" />`; on a persisted save it optimistically shows a
  "resolved" state (honest about sample vs warehouse), backed on configured deployments by
  the Phase-0 `review_queue` anti-join.
- **`app/(dashboard)/rules/page.tsx` & `categories/page.tsx`** *(wire-in)* — fetch
  `getCategories()` as `categoryOptions` (avoids the existing `categories` insight binding)
  and render `ReviewQueueCard` in place of the static review divs.

**Implementation notes / small choices:** followed the repo's client-fetch-to-route-handler
idiom (not Server Actions), per the Next 16 `use client` + mutating-data docs. The inline
variant keeps note + preview always-visible (compact) rather than behind an expand —
simpler, and the form is already short; revisit if it feels cramped at 375px in practice.

### Verification matrix
| Check | Result |
|---|---|
| `npm run dataform:compile` | ✓ 32 actions compiled |
| `npm run typecheck` (`tsc --noEmit`) | ✓ 0 errors |
| `npm run lint` (`eslint .`, incl. `react-hooks/*`) | ✓ 0 errors |
| `npm test` (node --test) | ✓ **85 pass / 0 fail** (override-plan 25, override-form-state 13, + 47 pre-existing) |
| `npm run build` (Next 16 prod build) | ✓ all routes + dashboard pages compile |
| Runtime boot smoke (`next start`, sample mode) | ✓ Ready 129ms · `/sign-in` 200 · `/rules` `/categories` `/transactions` 302→sign-in (auth-gated) |

**Component testing approach.** The React components import `next/navigation`/React and
can't be imported under `node --test` (same constraint as the routes), so their logic was
**extracted into the pure `override-form-state.ts` and unit-tested** (13 tests), with the
JSX/props/hooks-rules validated by `typecheck` + `lint` + `build`. The runtime smoke test
confirms the server renders the pages without crashing.

**Environment ceiling (honest gap).** An *authenticated* visual render of the inline cards
could not be exercised here: the `(dashboard)` middleware redirects unauthenticated requests
to `/sign-in`, and the credentials/auth DB needed to sign in isn't configured in this
sandbox. A final interactive visual pass (open `/rules`, edit a card, see the dry-run
preview + resolved state) should be done via `/run` on a dev machine where auth + sample
data are available. Everything up to that boundary is green.

### State
All changes are in the **working tree on `main`, not committed** (no commit/push was
requested). Phases 0–5 complete.

