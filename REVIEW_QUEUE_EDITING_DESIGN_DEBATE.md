# Design Debate — Editable Review Queue → Overrides & Categorization Rules

> **Format.** This is a living, adversarial design review. Two agents argue toward an
> optimal buildout:
> - **Agent A — "Builder"** (me): proposes the implementation, defends tradeoffs.
> - **Agent B — "Red Team"**: a highly qualified critic whose only goal is to find the
>   strongest objection, the cheaper path, and the failure mode A is underweighting.
>
> Each round ends with **Deltas** (concrete changes adopted) and **Open Decisions**
> (needs a human ruling or another round). When both agents sign off, the agreed design
> is promoted into `PLAN.md` for buildout. The canonical detailed plan still lives in
> `PLAN.md`; this doc is where it earns its keep.
>
> _Status: Round 3 complete. Agent C (verification pass) + human rulings on O1–O4.
> Promoted to `PLAN.md` for buildout. See "Round 3" below._

---

## Problem statement (shared, not disputed)

The Rules & Review and Categories pages render the "Review queue" as **static** cards.
We want each card editable so a user can set the correct category (+ note) and have that
(1) persist as a **manual override** and (2) optionally create/seed a **categorization
rule**, improving the agent. Verified mechanics:

- `fact_classification` priority: **override (1.00) → rule (0.95, `merchant_rule`) →
  accepted AI (≥0.90) → fallback**.
- Overrides also become AI `manualExamples`.
- `/api/categories/override` already writes override + *pending* suggestion;
  `/api/rule-suggestions/[id]` accept promotes suggestion → `category_rules`.
- Tables exist; **no migration**. Marts are **batch** (need `dataform run`). No BigQuery in
  this env → sample mode returns `persisted:false`.

---

## Round 1

### A1 — Builder's opening proposal
1. **Backend:** pure helper `lib/categorization/override-plan.ts`
   (`resolveRuleAction`, `buildCategoryRuleRow`) + extend `/api/categories/override` with
   `ruleAction: none | suggest | create` (legacy `createRuleSuggestion` maps to
   `suggest`/`none`, keeping the transaction drawer working).
2. **Frontend:** reusable client `components/rules/review-queue-card.tsx` with a category
   `<Select>`, note `<Input>`, and a 3-way learning action (`none|suggest|create`,
   default `suggest`). Wire into Rules + Categories review queues; each page also fetches
   `getCategories()`.
3. **Tests:** `node --test` unit test for the helper; lint/typecheck/build; headless
   screenshots at 375/1280.
4. **Rationale:** reuses the existing loop; minimal new surface; review-first default
   keeps an audit trail; overrides win immediately and teach the AI.

### B1 — Red Team's critique
- **B1.1 — You're reinventing the transaction drawer.** `TransactionDrawer` already has a
  category `<select>` + "Save override" that POSTs to the same endpoint and creates a
  suggestion. A new bespoke form on the review card **duplicates** that logic and will
  drift. Extract a single shared `OverrideForm` (category + note + action) and consume it
  in **both** the drawer and the review card. One code path, one set of bugs.
- **B1.2 — "Create rule now" from one example is dangerous.** `buildRuleSuggestionDraft`
  defaults to `merchant_contains` on a normalized merchant. A short/ambiguous token (e.g.
  `"sq"`, `"amazon"`, a 3-char merchant) becomes a broad `LIKE %token%` rule at priority
  110 that silently re-buckets *many* transactions on the next Dataform run — with
  confidence 0.95, ranked above AI. That's a footgun. Need **guardrails**: minimum
  match-value length, prefer `merchant_exact` for short tokens, and show the user the
  exact rule ("This will auto-categorize anything whose merchant contains `peet`") before
  they commit.
- **B1.3 — No rule de-duplication.** `category_rules` is insert-only with no upsert.
  "Create rule" twice for the same merchant → duplicate rules, double counting, messy
  Rules page. Need idempotency: dedupe by `(user_id, match_strategy, match_value,
  category_id)` — skip or supersede.
- **B1.4 — The queue won't update, so the UX lies.** `review_queue` is a **view** over
  `fact_transaction_current`, refreshed only by `dataform run`. User edits a card, hits
  save, `router.refresh()` … and the card is **still there, unchanged**. That reads as a
  broken save. You need an **optimistic "Resolved — applies after next warehouse
  refresh"** state on the card (client-side), not a silent refresh.
- **B1.5 — Untestable persistence ≠ untestable route.** A pure-helper test is necessary
  but weak. Inject the BigQuery writer (a `RowWriter` seam) so the route's branching
  (`none|suggest|create`, draft-null, partial-failure) is covered with a **fake writer** —
  real behavioral coverage without BigQuery.
- **B1.6 — Default action.** `suggest` is safe but adds a second click later (accept on
  Rules page) before the agent generalizes. For a power user fixing 20 rows, that's
  friction. Consider default `suggest`, but make `create` one click and make the
  *accept* of pending suggestions a bulk action. (Scope check on bulk.)
- **B1.7 — Minor:** `getCategories()` is unfiltered by user and re-queried per page;
  fine, but confirm it's cached/cheap. `suggestedCategory` is a label → label→id mapping
  can collide if two categories share a label (unlikely, but assert uniqueness).

### A1′ — Builder's rebuttal
- **Accept B1.1** (shared `OverrideForm`) — strictly better; eliminates drift. Adopt.
- **Accept B1.2** with scope: add guardrails in `buildRuleSuggestionDraft`/helper — if
  `matchValue.length < 4` or token count < 2, force `merchant_exact`; always render a
  human-readable "what this rule will match" preview in the UI. Adopt.
- **Accept B1.3** — add dedupe in the route before insert (query existing active rules by
  the tuple; skip + report "rule already exists"). Adopt.
- **Accept B1.4** — optimistic per-card "Resolved" state with the warehouse-refresh hint;
  do **not** rely on `router.refresh()` to remove the card. Adopt.
- **Accept B1.5** — add a `RowWriter` injection seam to the route (default = real
  `insertBigQueryRows`) and a fake in tests. Adopt (small surface).
- **Partially accept B1.6** — keep default `suggest`; **defer bulk-accept** as a fast
  follow (explicitly out of scope for round 1 buildout) to avoid scope creep.
- **Accept B1.7** — assert label uniqueness when mapping; keep `getCategories()` as-is.

### Round 1 — Deltas adopted
- D1. Extract shared **`components/transactions/override-form.tsx`** used by the drawer
  **and** the review card.
- D2. **Rule guardrails**: min match length / token heuristic → `merchant_exact`
  fallback; **UI preview** of the rule's match before commit.
- D3. **Rule de-duplication** by `(user_id, match_strategy, match_value, category_id)`.
- D4. **Optimistic "Resolved (applies after warehouse refresh)"** card state.
- D5. **`RowWriter` seam** + fake-writer route tests (in addition to helper unit tests).

### Round 1 — Open Decisions
- O1. Default learning action: `suggest` (review-first) vs `create` (immediate)?
- O2. Bulk-accept of suggestions: in scope now, or fast-follow?

---

## Round 2

### B2 — Red Team, second pass (after the deltas)
- **B2.1 — De-dupe across the priority ladder, not just within `category_rules`.** A
  per-transaction **override** already pins category at conf 1.00. If the user also
  "creates a rule" for that same merchant, that's usually desirable (generalization) — but
  if the override and the rule **disagree** later (user changes their mind on one row),
  the override still wins for that row while the rule governs the rest. That's actually
  correct behavior — just make sure the UI never implies the rule will change the *other*
  rows retroactively before a Dataform run. Tighten the copy.
- **B2.2 — `merchant_norm` is the join key, but the review item doesn't carry it.** The
  route re-fetches the transaction (good), but the **UI preview** of "what this rule
  matches" needs the normalized merchant. Either (a) compute the preview server-side and
  return it from a dry-run, or (b) include `merchantNorm` on the review item. (a) avoids
  shipping normalization to the client and keeps one source of truth. Recommend a
  `dryRun` flag on the override route that returns the *planned* rows without inserting.
- **B2.3 — Optimistic state must survive the eventual refresh.** When Dataform does run
  later and the row leaves the queue, the optimistic "Resolved" item simply disappears on
  next load — fine. But if persistence **failed** (sample mode / BQ error), the optimistic
  "Resolved" state is a lie. Gate the optimistic state on `persisted === true`; in sample
  mode show "Saved locally (not persisted — no warehouse configured)".
- **B2.4 — Don't fork `OverrideForm` UX between drawer and queue.** The drawer's form is
  vertical and rich; the queue card is dense. Keep **one component** but allow a `variant`
  prop (`"drawer" | "inline"`) for layout only — logic stays shared.
- **B2.5 — Concede default action.** Given guardrails (D2) + dedupe (D3) + preview (B2.2),
  `create` is no longer reckless. But `suggest` remains the safer default for a finance
  app where wrong rules silently move money categories. **B recommends default `suggest`,
  with `create` prominent.** (Still a human call → O1.)

### A2′ — Builder's response
- **Accept B2.2** — add a **`dryRun: true`** path to `/api/categories/override` that
  returns `{ override, ruleAction, rule|ruleSuggestion, dedupe: "new"|"exists",
  matchPreview }` **without** inserting. The card calls dryRun on expand/category-change to
  render an accurate preview; the real save reuses the same plan. This subsumes B1.2's UI
  preview cleanly and keeps normalization server-side. Adopt.
- **Accept B2.3** — optimistic "Resolved" only when `persisted === true`; otherwise show
  the sample/error message. Adopt.
- **Accept B2.4** — `OverrideForm` gets a layout-only `variant` prop. Adopt.
- **Accept B2.1** — tighten copy: "Creates a rule for future and similar transactions;
  existing transactions update on the next warehouse refresh." Adopt.
- **On O1** — both agents lean **default `suggest`**; promote to recommendation, flag for
  human confirmation.

### Round 2 — Deltas adopted
- D6. **`dryRun` mode** on the override route returning the planned rows + `matchPreview` +
  `dedupe` status; the card renders the preview from this (no client-side normalization).
- D7. Optimistic "Resolved" state **gated on `persisted === true`**; explicit sample/error
  messaging otherwise.
- D8. `OverrideForm` single component with `variant: "drawer" | "inline"` (layout only).
- D9. Copy tightened so users understand override-now vs rule-applies-after-refresh.

### Round 2 — Remaining Open Decisions (for the human)
- **O1 (recommendation: `suggest`).** Default learning action — `suggest` (review-first,
  safer) vs `create` (immediate generalization). Both agents recommend **`suggest`**.
- **O2 (recommendation: fast-follow).** Bulk-accept of suggestions / bulk-resolve in the
  queue — ship now or as a follow-up? Both agents recommend **fast-follow** (keep round-1
  scope tight).
- **O3 (new).** Should "create rule" be allowed to **supersede** an existing duplicate
  rule (raise priority / update category) or strictly **skip** when a matching rule
  exists? Recommendation: **skip + inform** in round 1; supersede later.

---

## Current consensus design (to promote into PLAN.md once O1–O3 are ruled)

1. **Shared `OverrideForm`** (`variant: drawer | inline`) — category select + note +
   action (`none|suggest|create`) + live **match preview** from a server **dryRun**.
2. **`/api/categories/override`** extended: `ruleAction`, `dryRun`, **rule guardrails**
   (short-token → `merchant_exact`), **dedupe** by tuple, **partial-failure tolerance**,
   **`RowWriter` seam**. Back-compat preserved for the drawer.
3. **`ReviewQueueCard`** (uses `OverrideForm` inline) wired into Rules + Categories
   queues; **optimistic "Resolved" gated on `persisted`**.
4. **Tests:** pure helper unit tests **+ route tests via fake `RowWriter`** covering
   `none|suggest|create`, dryRun, dedupe, draft-null (internal category), partial failure.
5. **Verify:** lint / typecheck / build / new tests; headless screenshots 375 + 1280 of
   collapsed, expanded(+preview), and resolved states.

## Sign-off
- **Agent B:** "No remaining strong objections given D1–D9 and O1–O3 resolved. Approve for
  buildout once the human rules O1–O3."
- **Agent A:** "Agreed. Ready to promote to `PLAN.md` and build on your go."

---

## Round 3 — Agent C (verification pass) + human rulings

**C opened the layer A and B never did** (`fact_classification.sqlx`, the refresh
model) and ground-truthed every claim. Five strong objections, all **missed by both
A and B**, three of them blockers — each verified against source:

- **C3.1 (blocker).** Rule ladder is non-deterministic: `fact_classification.sqlx:39-42`
  ranks `matched_rules` by `priority desc` with **no tiebreaker**, and every learned
  rule is `priority 110`. Two rules on one txn → arbitrary, run-to-run-unstable
  category. A/B blessed the conflict case (B2.1) reasoning only override-vs-rule,
  never rule-vs-rule — which the proposed dedupe key (incl. `category_id`) actively
  permits.
- **C3.2 (blocker).** Dedupe key must **drop `category_id`** (else contradictory
  `peets→A` / `peets→B` both survive → feeds C3.1) and supersede on conflict.
- **C3.3 (blocker).** "Resolved after refresh" is dishonest: `persisted` only means
  the override INSERT landed; `review_queue` is a batch view and **nothing schedules
  `dataform run`** (only `scripts/process-dropbox.sh:115`). B2.3 had it backwards.
- **C3.4.** Write-boundary unsafe once `create` ships: unescaped LIKE (`:49`),
  unvalidated regex into a shared `type:"table"` (`:50`), unvalidated `category_id`
  pinned at 1.00 (`override/route.ts:69`), and no rule-disable path.
- **C3.5.** Rubber-stamp loop: pre-selecting the AI guess self-trains the model.
- **C3.6.** The route isn't unit-testable as A1.3/D5 assumed; test a **pure helper**.

**Human rulings (2026-06-22):** O1 → **include `create`-now**; O2/O3 → **fix the full
safety package now** (tiebreaker, category validation, regex/LIKE validation,
rule-disable/rollback); O4 → **view-level resolution** (anti-join `manual_overrides`
in `review_queue`); modality → **shared `OverrideForm` + `variant`**.

**Resolution:** Promoted to `PLAN.md` (Phases 0–5). Phase 0 fixes the warehouse
invariants C3.1–C3.4 first; Phase 1 puts every rule write through a unit-tested pure
chokepoint (`override-plan.ts`) that resolves C3.2/C3.5/C3.6.

---

### How to keep debating
- Want more rounds? Tell me which delta or open decision to push on and I'll run another
  A/B exchange.
- Have a *real* second agent? Paste its critique under a new `### B3 — …` heading and I'll
  respond as Agent A and fold the deltas in.
- Ready to build? Rule on O1–O3 (or accept the recommendations) and I'll update `PLAN.md`
  and start execution.
