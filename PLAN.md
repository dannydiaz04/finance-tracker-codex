# PLAN — Editable Review Queue → Overrides, Rules & Warehouse Safety

> Promoted from `REVIEW_QUEUE_EDITING_DESIGN_DEBATE.md` after a third (Agent C)
> adversarial pass that ground-truthed every claim against source and surfaced
> blockers A and B missed. Human rulings (2026-06-22):
> **O1 = include `create`-now · O2/O3 = full safety package now · O4 = view-level
> resolution · modality = shared `OverrideForm` + variant.**

## Build status (updated as phases land)

- ✅ **Phase 0** — warehouse SQL (rule tiebreaker, `strpos` for contains,
  latest-row-per-`rule_id` + `enabled`, `review_queue` anti-join +
  `current_category_id`/`merchant_norm`). `dataform:compile` ✓.
- ✅ **Phase 1** — `lib/categorization/override-plan.ts` + 25 unit tests (97 total). ✓.
- ✅ **Phase 2** — routes: override (`ruleAction`/`dryRun`/category-validation/
  user-scoped `matchCount`/supersede + deterministic ids); `/api/rules` guardrails +
  `DELETE` (disable); accept-route dedupe/guardrails/supersede. typecheck ✓ lint ✓ build ✓.
- ✅ **Phase 3** — `ReviewQueueItem` += `currentCategoryId`/`merchantNorm`; both queries +
  sample data. typecheck ✓.
- ✅ **Phase 4** — shared `OverrideForm` (`variant: drawer|inline`) + inline
  `ReviewQueueCard` wired into Rules + Categories; drawer refactored to consume it. Pure
  UI logic in `override-form-state.ts` (13 tests). No AI pre-select; debounced dry-run
  preview; partial-failure-aware result line.
- ✅ **Phase 5** — lint ✓ typecheck ✓ build ✓ **85 tests** ✓ dataform compile ✓ +
  runtime boot smoke (server Ready, public 200, dashboard auth-gated). Authenticated
  visual render needs the auth DB (not configured in this env) — see `REVIEW_QUEUE_BUILD_LOG.md`.

**Deliberate deviations from the consensus design (with rationale):**
- **RowWriter route seam (D5) dropped** in favor of unit-testing the pure `override-plan`
  chokepoint directly. Verification proved importing a route under `node --test` is
  infeasible (`next/server` + `@/` alias + top-level DB init), so a route-level writer
  seam buys no real coverage — all branching lives in the tested helper instead.
- **`suggestedCategoryId` → `currentCategoryId`** on the review item: the form needs the
  *current* derived category (for the anti-rubber-stamp no-op guard), not an id for the
  AI's suggested label. The AI suggestion stays a read-only label.

## Why the scope is what it is

The editable card itself is small. The weight is in making "create an active rule"
safe, because that path writes to `category_rules`, which the warehouse trusts at
0.95 (above AI) on the next `dataform run`. The debate signed off without opening
`fact_classification.sqlx`; verification found load-bearing defects there. Since we
ship `create`-now, those defects are in-scope, not deferrable.

### Verified ground truth (file:line)
- **Rule ladder is non-deterministic.** `fact_classification.sqlx:39-42` ranks
  `matched_rules` `order by rules.priority desc` with **no tiebreaker**; every
  learned rule is `priority: 110` (`rule-suggestions/[suggestionId]/route.ts:143`).
  Two rules on one txn → arbitrary, run-to-run-unstable winner.
- **LIKE injection / regex DoS at the write boundary.** `fact_classification.sqlx:49`
  `like concat('%', lower(match_value), '%')` (no escape); `:50`
  `regexp_contains(..., lower(match_value))` with raw user input, inside a
  `type:"table"` build → one bad rule re-buckets a whole history or fails the
  shared table for everyone. `/api/rules` validates `matchValue: z.string().min(1)`
  only; no DELETE/PATCH to disable a bad rule.
- **Override pins an unvalidated category_id at conf 1.00.** `override/route.ts:69`
  writes `payload.categoryId` regardless of the `category` lookup (which only gates
  the suggestion). Bad id → NULL `category_label` into every mart.
- **Resolution lies / no refresh cadence.** `review_queue` is a batch view; the only
  `dataform run` in the repo is `scripts/process-dropbox.sh:115`. A client-only
  "Resolved" reappears on reload; an override is otherwise invisible until the next
  manual import.
- **Rubber-stamp loop.** Overrides become conf-1.00 rows AND AI `manualExamples`
  (`category-classifier.ts:984-1040`). Pre-selecting the AI's own guess turns a
  one-click Save into self-training on model output labeled as ground truth.
- **Route is not unit-testable as the doc assumed.** Importing `POST()` under
  `node --conditions=react-server --experimental-strip-types --test` fails
  (`next/server` unresolved, `@/` alias unresolved, importing boots NextAuth+pg).
  Testable surface = a pure helper with relative imports + injected lookups/writer.
- `insertBigQueryRows` returns `boolean` (not `{persisted}`); `review_queue.sqlx`
  only projects `suggested_category` as a **label**, but `derived_category_id` and
  `merchant_norm` are one SELECT away in `fact_transaction_current`.

---

## Phase 0 — Warehouse correctness & safety (Dataform SQLX)

*Compile-validated here (`npm run dataform:compile`); takes effect on the user's next
`dataform run`/deploy. BQ is not configured in this env, so runtime is exercised via
the sample path.*

1. **Deterministic + supersede-aware rule matching** in
   `dataform/definitions/core/fact_classification.sqlx`:
   - Pre-collapse `category_rules` to the latest row per `(user_id, rule_id)`
     (`row_number() ... order by created_at desc`) and keep only `coalesce(enabled,
     true)` — so a disabled tombstone (Phase 2) actually turns a rule off.
   - Replace `merchant_contains` LIKE with a literal substring test
     `strpos(lower(merchant_norm), lower(match_value)) > 0` (kills `%`/`_` injection;
     matches JS `.includes` semantics).
   - Add a tiebreaker to `matched_rules`:
     `order by rules.priority desc, rules.created_at desc, rules.rule_id`.
2. **Real resolution** in `dataform/definitions/ops/review_queue.sqlx`:
   - LEFT JOIN `manual_overrides` on `(user_id, transaction_id)`; add
     `and manual_overrides.transaction_id is null` to the WHERE so any overridden
     txn leaves the queue immediately (the view reads the live operational table per
     query — no full rebuild needed).
   - Project `current_txn.derived_category_id as suggested_category_id` and
     `current_txn.merchant_norm`.
3. **Override CTE tiebreaker**: in `fact_classification.sqlx` override CTE, order by
   `updated_at desc, transaction_id` (defensive against same-ms writes).
4. Optional assertion: quarantine `description_regex` rules that fail validity so one
   bad pattern can't fail the table (primary defense is write-boundary validation).

**Verify:** `npm run dataform:compile`.

## Phase 1 — Pure orchestrator `lib/categorization/override-plan.ts` (fully unit-tested)

Single chokepoint every rule write flows through. Relative imports only (testable
under the repo's `node --test`).

- `resolveRuleAction(legacyCreateRuleSuggestion?, ruleAction?) → 'none'|'suggest'|'create'`
  (back-compat: `true→'suggest'`, `false→'none'`; explicit `ruleAction` wins).
- `applyRuleGuardrails({matchStrategy, matchValue}) → {matchStrategy, matchValue}`:
  normalize match_value for merchant strategies (`normalizeMerchant` — strips `%`/`_`
  for free); `matchValue.length < 4` or single token → force `merchant_exact`;
  aggregator denylist (`uber, amazon, sq, square, paypal, venmo, apple, google,
  cash app, zelle`) → force `merchant_exact`; `description_regex` → validate via
  `new RegExp` + length cap, throw on invalid.
- `dedupePlan(existingRules, {userId, matchStrategy, matchValue, categoryId}) →
  'new'|'exists'|'conflict'` keyed on `(user_id, normalized match_value)` **without
  category_id** (collapse merchant_exact/contains overlap); `conflict` = same value,
  different category.
- `buildCategoryRuleRow({userId, draft, now})` (priority 110 — safe now that ties
  are broken + dedupe blocks contradictions).
- `computeMatchPreview({matchStrategy, matchValue, categoryLabel})` → human string.
- `planOverride({userId, transaction, category, action, existingRules, now})` →
  `{overrideRow, ruleAction, ruleSuggestion|null, ruleRow|null, dedupe, matchPreview}`.
  Returns `none`/null cleanly for internal categories (reuse
  `buildRuleSuggestionDraft` null rules) and suppresses suggestion/rule when the
  chosen category equals the current derived category (anti-rubber-stamp).

**Tests:** `tests/categorization/override-plan.test.mjs` — action mapping, guardrails
(short/aggregator/bad-regex), dedupe new/exists/conflict, planOverride per action,
draft-null, unchanged-category suppression, preview text. Wire `package.json`: switch
aggregate `test` to a single recursive `node ... --test "tests/**/*.test.mjs"` so new
dirs aren't orphaned.

## Phase 2 — Routes (thin adapters over Phase 1)

- **`/api/categories/override`**: accept `ruleAction` + `dryRun`; **validate
  category_id** (400 on unknown; write `category.id`). Fetch user-scoped existing
  rules; call `planOverride`. `dryRun:true` → return `{plan, matchPreview, dedupe,
  matchCount}` **without** inserting, where `matchCount` is a **user-scoped** count
  against `fact_transaction_current` using the warehouse's exact predicate
  (`strpos`/exact/`regexp_contains`) — honest blast radius. Inject a `RowWriter`
  (default `insertBigQueryRows`). Per-step persisted flags; deterministic
  `suggestion_id` keyed on `(user_id, transaction_id, category_id)` so retries
  collide. Keep `createRuleSuggestion` back-compat so the drawer keeps working.
- **`/api/rules`**: run `applyRuleGuardrails` on POST (normalize/validate; reject
  bad regex / over-broad); fix category label lookup to use `getCategories()` not
  `sampleCategories`. Add **`DELETE`** (disable): insert a tombstone row with
  `enabled=false` (Phase 0 honors latest-per-rule_id).
- **`/api/rule-suggestions/[suggestionId]` accept**: dedupe at the real
  `category_rules` write — skip on `exists`, supersede on `conflict`; idempotent on
  `rule_id`; run guardrails on the suggestion's match_value. On a new override that
  supersedes an earlier one for the same txn, mark stale pending suggestions
  `superseded`.

## Phase 3 — Data threading (types, queries, sample data)

- `ReviewQueueItem` += `suggestedCategoryId: string | null`, `merchantNorm: string`.
- `lib/queries/rules.ts` (`getLowConfidenceReviewItems`) + `lib/queries/categories.ts`
  (`getReviewQueue`): SELECT the two new columns.
- `lib/sample-data.ts`: populate them on `sampleReviewQueue`.
- Handle label-with-no-matching-id (leave select unselected, never silent option[0]).

## Phase 4 — Shared `OverrideForm` + inline `ReviewQueueCard` (UI)

*Read `node_modules/next/dist/docs/01-app` (client components / route handlers) before
writing — per AGENTS.md this is not training-data Next.*

- `components/transactions/override-form.tsx` — extract the drawer's form. Props:
  `{ transactionId, merchantNorm, currentCategoryId, suggestedCategoryId, categories,
  variant: 'drawer'|'inline', onResolved }`. Shared logic: native `<select>` (good
  for iOS), note input, 3-way action default `suggest`, debounced `dryRun` preview,
  `isSaving` guard, persisted/partial-failure-aware result. **Do not pre-select the
  AI suggestion**; suppress suggest/create when category unchanged; aria-label the
  dense controls. `variant` = layout only.
- Refactor `TransactionDrawer` to render `<OverrideForm variant="drawer" />`
  (behavior preserved).
- `components/rules/review-queue-card.tsx` — `<OverrideForm variant="inline" />`;
  optimistic hide on `persisted===true` (sample-mode UX) backed by the real Phase-0
  view exclusion on configured deployments; distinct "category saved / rule failed"
  state; explicit 375px layout (note+preview behind expand).
- Wire into `app/(dashboard)/rules/page.tsx` and `app/(dashboard)/categories/page.tsx`
  (pass server-fetched `categories`).

## Phase 5 — Verify

`npm run lint` · `npm run typecheck` · `npm run build` · `npm test` (incl. new
categorization suite) · `npm run dataform:compile`. Manual visual check via `/run`
(no headless tooling/CI in repo — not a gate). Sample path (`persisted:false`)
exercises behavior without BigQuery; the SQLX changes deploy on the user's next
`dataform run`.

## Out of scope / follow-ups
- Bulk-accept of suggestions (reduces the O1+O2 single-item friction).
- Scheduled `dataform run` (cron/CI) — until then, resolution is honest via the
  Phase-0 view exclusion but full re-classification still waits on the next import.
- `MERGE`-based override upsert (streaming inserts can't MERGE; mitigated by
  deterministic suggestion_id + in-flight guard + CTE tiebreaker).
