import assert from "node:assert/strict";
import test from "node:test";

import { planOverride } from "../../lib/categorization/override-plan.ts";
import { persistOverridePlansWithDependencies } from "../../lib/categorization/override-persistence-core.ts";

const USER_ID = "user-1";
const NOW = "2026-07-28T12:00:00.000Z";
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

function existingRule(overrides = {}) {
  return {
    id: "rule-existing",
    name: "Wholefoods -> Dining",
    description: "Legacy rule.",
    priority: 90,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.8,
    hitRate: 0.5,
    lastMatchedAt: "2026-07-01",
    ...overrides,
  };
}

function toExistingPlanRule(rule) {
  return {
    ruleId: rule.id,
    matchStrategy: rule.matchStrategy,
    matchValue: rule.matchValue,
    categoryId: rule.categoryId,
    enabled: rule.enabled,
  };
}

function plannedCreateConflict(rule = existingRule()) {
  const plan = planOverride({
    userId: USER_ID,
    transaction: baseTransaction({ transactionId: "txn-1" }),
    category: groceries,
    action: "create",
    existingRules: [toExistingPlanRule(rule)],
    now: NOW,
    suggestionId: "suggestion-txn-1",
    ruleId: "learned-txn-1",
  });

  assert.equal(plan.supersedeRuleId, rule.id);
  assert.ok(plan.ruleRow);
  return { transactionId: "txn-1", plan };
}

function plannedSuggestion() {
  const plan = planOverride({
    userId: USER_ID,
    transaction: baseTransaction({
      transactionId: "txn-2",
      merchantRaw: "TARGET STORE 123",
      merchantNorm: "target",
      descriptionNorm: "target store 123",
    }),
    category: groceries,
    action: "suggest",
    existingRules: [],
    now: NOW,
    suggestionId: "suggestion-txn-2",
    ruleId: "learned-txn-2",
  });

  assert.ok(plan.ruleSuggestion);
  return { transactionId: "txn-2", plan };
}

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "stale-suggestion",
    transaction_id: "txn-2",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "target",
    rule_name: "Target -> Dining",
    rule_description: "Old pending suggestion.",
    source: "manual_override",
    note: "old note",
    created_at: "2026-07-27T12:00:00.000Z",
    ...overrides,
  };
}

function recordingDependencies({ insertRows, pending = [] } = {}) {
  const calls = [];

  return {
    calls,
    deps: {
      isConfigured: () => true,
      insertRows: async (datasetId, tableId, rows) => {
        calls.push({ datasetId, tableId, rows });
        if (insertRows) {
          return insertRows(datasetId, tableId, rows);
        }
        return true;
      },
      getPendingSuggestionsForTransactions: async () => pending,
    },
  };
}

test("persistOverridePlans writes overrides, superseded rules, and stale suggestion tombstones", async () => {
  const conflictingRule = existingRule();
  const createPlan = plannedCreateConflict(conflictingRule);
  const suggestionPlan = plannedSuggestion();
  const { calls, deps } = recordingDependencies({
    pending: [
      pendingSuggestion(),
      pendingSuggestion({ suggestion_id: "suggestion-txn-2" }),
    ],
  });

  const results = await persistOverridePlansWithDependencies(deps, {
    userId: USER_ID,
    planned: [createPlan, suggestionPlan],
    existingRules: [conflictingRule],
    now: NOW,
  });

  assert.deepEqual(
    results.map((result) => ({
      transactionId: result.transactionId,
      persisted: result.persisted,
      rulePersisted: result.rulePersisted,
      ruleSuggestionPersisted: result.ruleSuggestionPersisted,
      ruleError: result.ruleError,
      ruleSuggestionError: result.ruleSuggestionError,
    })),
    [
      {
        transactionId: "txn-1",
        persisted: true,
        rulePersisted: true,
        ruleSuggestionPersisted: false,
        ruleError: null,
        ruleSuggestionError: null,
      },
      {
        transactionId: "txn-2",
        persisted: true,
        rulePersisted: false,
        ruleSuggestionPersisted: true,
        ruleError: null,
        ruleSuggestionError: null,
      },
    ],
  );

  assert.deepEqual(
    calls.map((call) => call.tableId),
    ["manual_overrides", "category_rules", "category_rule_suggestions"],
  );
  assert.equal(calls[0].rows.length, 2);

  const [disabledRule, learnedRule] = calls[1].rows;
  assert.equal(disabledRule.rule_id, "rule-existing");
  assert.equal(disabledRule.enabled, false);
  assert.equal(disabledRule.category_id, "dining");
  assert.equal(disabledRule.created_at, NOW);
  assert.equal(learnedRule.rule_id, "learned-txn-1");
  assert.equal(learnedRule.enabled, true);
  assert.equal(learnedRule.category_id, "groceries");

  const [staleSuggestion, newSuggestion] = calls[2].rows;
  assert.equal(staleSuggestion.suggestion_id, "stale-suggestion");
  assert.equal(staleSuggestion.status, "superseded");
  assert.equal(staleSuggestion.updated_at, NOW);
  assert.equal(staleSuggestion.reviewed_at, NOW);
  assert.equal(newSuggestion.suggestion_id, "suggestion-txn-2");
  assert.equal(newSuggestion.status, "pending");
});

test("persistOverridePlans reports partial rule and suggestion failures without failing overrides", async () => {
  const conflictingRule = existingRule();
  const { deps } = recordingDependencies({
    insertRows: async (_datasetId, tableId) => {
      if (tableId === "category_rules") {
        throw new Error("rules unavailable");
      }
      if (tableId === "category_rule_suggestions") {
        throw new Error("suggestions unavailable");
      }
      return true;
    },
  });

  const results = await persistOverridePlansWithDependencies(deps, {
    userId: USER_ID,
    planned: [plannedCreateConflict(conflictingRule), plannedSuggestion()],
    existingRules: [conflictingRule],
    now: NOW,
  });

  assert.equal(results[0].transactionId, "txn-1");
  assert.equal(results[0].persisted, true);
  assert.equal(results[0].rulePersisted, false);
  assert.equal(results[0].ruleError, "rules unavailable");
  assert.equal(results[0].ruleSuggestionError, null);

  assert.equal(results[1].transactionId, "txn-2");
  assert.equal(results[1].persisted, true);
  assert.equal(results[1].rulePersisted, false);
  assert.equal(results[1].ruleError, null);
  assert.equal(results[1].ruleSuggestionPersisted, false);
  assert.equal(results[1].ruleSuggestionError, "suggestions unavailable");
});
