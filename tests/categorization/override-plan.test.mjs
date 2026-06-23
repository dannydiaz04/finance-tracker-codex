import assert from "node:assert/strict";
import test from "node:test";

import {
  RuleGuardrailError,
  applyRuleGuardrails,
  buildCategoryRuleRow,
  computeMatchPreview,
  dedupePlan,
  planOverride,
  resolveRuleAction,
} from "../../lib/categorization/override-plan.ts";

const groceries = { id: "groceries", label: "Groceries" };

function baseTransaction(overrides = {}) {
  return {
    transactionId: "txn-1",
    merchantRaw: "WHOLEFOODS 10429",
    merchantNorm: "wholefoods",
    descriptionNorm: "wholefoods chicago il",
    transactionClass: "expense",
    derivedCategoryId: "uncategorized",
    ...overrides,
  };
}

// --- resolveRuleAction ---------------------------------------------------------

test("resolveRuleAction: explicit ruleAction wins over the legacy boolean", () => {
  assert.equal(resolveRuleAction({ ruleAction: "create", createRuleSuggestion: true }), "create");
  assert.equal(resolveRuleAction({ ruleAction: "none", createRuleSuggestion: true }), "none");
});

test("resolveRuleAction: legacy boolean maps to suggest/none, default is suggest", () => {
  assert.equal(resolveRuleAction({ createRuleSuggestion: true }), "suggest");
  assert.equal(resolveRuleAction({ createRuleSuggestion: false }), "none");
  assert.equal(resolveRuleAction({}), "suggest");
});

// --- applyRuleGuardrails -------------------------------------------------------

test("guardrails: a clean multi-token merchant stays merchant_contains", () => {
  const result = applyRuleGuardrails({ matchStrategy: "merchant_contains", matchValue: "Wholefoods Market" });
  assert.deepEqual(result, {
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods market",
    adjusted: false,
    reason: null,
  });
});

test("guardrails: payment aggregators are forced to merchant_exact", () => {
  const result = applyRuleGuardrails({ matchStrategy: "merchant_contains", matchValue: "Uber" });
  assert.equal(result.matchStrategy, "merchant_exact");
  assert.equal(result.matchValue, "uber");
  assert.equal(result.adjusted, true);
});

test("guardrails: short tokens are forced to merchant_exact", () => {
  const result = applyRuleGuardrails({ matchStrategy: "merchant_contains", matchValue: "KFC" });
  assert.equal(result.matchStrategy, "merchant_exact");
  assert.equal(result.matchValue, "kfc");
  assert.equal(result.adjusted, true);
});

test("guardrails: LIKE metacharacters are stripped before reaching the matcher", () => {
  const result = applyRuleGuardrails({ matchStrategy: "merchant_contains", matchValue: "a%b_c" });
  assert.ok(!result.matchValue.includes("%"), "percent must be removed");
  assert.ok(!result.matchValue.includes("_"), "underscore must be removed");
});

test("guardrails: a value that normalizes to empty is rejected", () => {
  assert.throws(
    () => applyRuleGuardrails({ matchStrategy: "merchant_contains", matchValue: "%%%" }),
    RuleGuardrailError,
  );
});

test("guardrails: a valid regex passes through untouched", () => {
  const result = applyRuleGuardrails({ matchStrategy: "description_regex", matchValue: "amazon.*prime" });
  assert.deepEqual(result, {
    matchStrategy: "description_regex",
    matchValue: "amazon.*prime",
    adjusted: false,
    reason: null,
  });
});

test("guardrails: an invalid regex is rejected (cannot fail the shared table build)", () => {
  assert.throws(() => applyRuleGuardrails({ matchStrategy: "description_regex", matchValue: "(" }), RuleGuardrailError);
});

test("guardrails: an overly long regex is rejected", () => {
  assert.throws(
    () => applyRuleGuardrails({ matchStrategy: "description_regex", matchValue: "a".repeat(201) }),
    RuleGuardrailError,
  );
});

// --- dedupePlan ----------------------------------------------------------------

const existing = (overrides = {}) => ({
  ruleId: "rule-existing",
  matchStrategy: "merchant_contains",
  matchValue: "wholefoods",
  categoryId: "groceries",
  enabled: true,
  ...overrides,
});

test("dedupe: no matching rule is new", () => {
  const result = dedupePlan({ existingRules: [], matchStrategy: "merchant_contains", matchValue: "wholefoods", categoryId: "groceries" });
  assert.equal(result.status, "new");
});

test("dedupe: same value + same category is exists", () => {
  const result = dedupePlan({
    existingRules: [existing()],
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    categoryId: "groceries",
  });
  assert.equal(result.status, "exists");
});

test("dedupe: same value + different category is a conflict (key excludes category_id)", () => {
  const result = dedupePlan({
    existingRules: [existing({ categoryId: "dining" })],
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    categoryId: "groceries",
  });
  assert.equal(result.status, "conflict");
  assert.equal(result.conflictCategoryId, "dining");
  assert.equal(result.conflictRuleId, "rule-existing");
});

test("dedupe: exact and contains collapse onto the same key", () => {
  const result = dedupePlan({
    existingRules: [existing({ matchStrategy: "merchant_exact", categoryId: "dining" })],
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    categoryId: "groceries",
  });
  assert.equal(result.status, "conflict");
});

test("dedupe: regex and merchant rules never collide", () => {
  const result = dedupePlan({
    existingRules: [existing()],
    matchStrategy: "description_regex",
    matchValue: "wholefoods",
    categoryId: "dining",
  });
  assert.equal(result.status, "new");
});

test("dedupe: disabled rules are ignored", () => {
  const result = dedupePlan({
    existingRules: [existing({ enabled: false, categoryId: "dining" })],
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    categoryId: "groceries",
  });
  assert.equal(result.status, "new");
});

// --- buildCategoryRuleRow + computeMatchPreview --------------------------------

test("buildCategoryRuleRow: learned rules are priority 110 / confidence 0.95", () => {
  const row = buildCategoryRuleRow({
    userId: "user-1",
    ruleId: "rule-1",
    now: "2026-06-22T00:00:00.000Z",
    draft: {
      categoryId: "groceries",
      categoryLabel: "Groceries",
      matchStrategy: "merchant_contains",
      matchValue: "wholefoods",
      ruleName: "Wholefoods -> Groceries",
      ruleDescription: "Learned from manual categorization of Wholefoods.",
    },
  });
  assert.equal(row.priority, 110);
  assert.equal(row.confidence_boost, 0.95);
  assert.equal(row.enabled, true);
  assert.equal(row.rule_id, "rule-1");
  assert.equal(row.created_at, "2026-06-22T00:00:00.000Z");
});

test("computeMatchPreview: phrasing differs per strategy", () => {
  assert.match(
    computeMatchPreview({ matchStrategy: "merchant_contains", matchValue: "wholefoods", categoryLabel: "Groceries" }),
    /contains .*wholefoods.* Groceries/,
  );
  assert.match(
    computeMatchPreview({ matchStrategy: "merchant_exact", matchValue: "uber", categoryLabel: "Transport" }),
    /exactly .*uber/,
  );
});

// --- planOverride --------------------------------------------------------------

const PLAN_IDS = { now: "2026-06-22T00:00:00.000Z", suggestionId: "sug-1", ruleId: "rule-1" };

test("planOverride: suggest on a real correction emits a pending suggestion, no active rule", () => {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction(),
    category: groceries,
    action: "suggest",
    existingRules: [],
    ...PLAN_IDS,
  });
  assert.equal(plan.ruleAction, "suggest");
  assert.equal(plan.ruleRow, null);
  assert.ok(plan.ruleSuggestion);
  assert.equal(plan.ruleSuggestion.match_value, "wholefoods");
  assert.equal(plan.ruleSuggestion.status, "pending");
  assert.equal(plan.ruleSuggestion.suggestion_id, "sug-1");
  assert.equal(plan.overrideRow.category_id, "groceries");
  assert.match(plan.matchPreview, /wholefoods/);
  assert.deepEqual(plan.match, { matchStrategy: "merchant_contains", matchValue: "wholefoods" });
});

test("planOverride: create on a new merchant emits an active rule row", () => {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction(),
    category: groceries,
    action: "create",
    existingRules: [],
    ...PLAN_IDS,
  });
  assert.equal(plan.ruleAction, "create");
  assert.equal(plan.dedupe, "new");
  assert.ok(plan.ruleRow);
  assert.equal(plan.ruleRow.rule_id, "rule-1");
  assert.equal(plan.ruleRow.priority, 110);
  assert.equal(plan.supersedeRuleId, null);
});

test("planOverride: create when an identical rule exists writes no duplicate", () => {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction(),
    category: groceries,
    action: "create",
    existingRules: [existing()],
    ...PLAN_IDS,
  });
  assert.equal(plan.dedupe, "exists");
  assert.equal(plan.ruleRow, null);
});

test("planOverride: create against a contradictory rule supersedes it", () => {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction(),
    category: groceries,
    action: "create",
    existingRules: [existing({ categoryId: "dining" })],
    ...PLAN_IDS,
  });
  assert.equal(plan.dedupe, "conflict");
  assert.ok(plan.ruleRow, "a corrected rule is still written");
  assert.equal(plan.supersedeRuleId, "rule-existing");
  assert.equal(plan.conflictCategoryId, "dining");
});

test("planOverride: confirming the current category learns nothing (anti-rubber-stamp)", () => {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction({ derivedCategoryId: "groceries" }),
    category: groceries,
    action: "create",
    existingRules: [],
    ...PLAN_IDS,
  });
  assert.equal(plan.ruleAction, "none");
  assert.equal(plan.ruleRow, null);
  assert.equal(plan.ruleSuggestion, null);
  // The override itself is still recorded.
  assert.equal(plan.overrideRow.category_id, "groceries");
});

test("planOverride: internal categories cannot become rules", () => {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction({ transactionClass: "transfer" }),
    category: { id: "transfers", label: "Transfers" },
    action: "create",
    existingRules: [],
    ...PLAN_IDS,
  });
  assert.equal(plan.ruleAction, "none");
  assert.equal(plan.ruleRow, null);
  assert.equal(plan.ruleSuggestion, null);
});

test("planOverride: a custom note becomes the override reason", () => {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction(),
    category: groceries,
    action: "none",
    note: "  split household run  ",
    existingRules: [],
    ...PLAN_IDS,
  });
  assert.equal(plan.overrideRow.reason, "split household run");
});
