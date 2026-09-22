import assert from "node:assert/strict";
import test from "node:test";

import { persistOverridePlansWithDependencies } from "../../lib/categorization/override-persistence-core.ts";
import { planOverride } from "../../lib/categorization/override-plan.ts";

const NOW = "2026-06-22T00:00:00.000Z";

const groceries = { id: "groceries", label: "Groceries" };
const travel = { id: "travel", label: "Travel" };

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
    id: "rule-dining",
    name: "Wholefoods -> Dining",
    description: "Old learned rule.",
    priority: 110,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.95,
    hitRate: 0,
    lastMatchedAt: null,
    ...overrides,
  };
}

function toExistingRule(rule) {
  return {
    ruleId: rule.id,
    matchStrategy: rule.matchStrategy,
    matchValue: rule.matchValue,
    categoryId: rule.categoryId,
    enabled: rule.enabled,
  };
}

function plannedCreateWithConflict(rule = existingRule()) {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction({ transactionId: "txn-create" }),
    category: groceries,
    action: "create",
    existingRules: [toExistingRule(rule)],
    now: NOW,
    suggestionId: "suggestion-create",
    ruleId: "rule-create",
  });
  assert.equal(plan.supersedeRuleId, rule.id);
  return { transactionId: "txn-create", plan };
}

function plannedSuggestion() {
  const plan = planOverride({
    userId: "user-1",
    transaction: baseTransaction({
      transactionId: "txn-suggest",
      merchantRaw: "UNITED AIRLINES",
      merchantNorm: "united airlines",
      descriptionNorm: "united airlines ticket",
    }),
    category: travel,
    action: "suggest",
    existingRules: [],
    now: NOW,
    suggestionId: "suggestion-keep",
    ruleId: "rule-suggest",
  });
  assert.ok(plan.ruleSuggestion);
  return { transactionId: "txn-suggest", plan };
}

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "suggestion-old",
    transaction_id: "txn-suggest",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "united airlines",
    rule_name: "United Airlines -> Dining",
    rule_description: "Old pending suggestion.",
    source: "manual_override",
    note: "stale",
    created_at: "2026-06-01T00:00:00.000Z",
    ...overrides,
  };
}

test("persistOverridePlansWithDependencies writes overrides, conflict tombstones, and superseded suggestions", async () => {
  const calls = [];
  const rule = existingRule();
  const planned = [plannedCreateWithConflict(rule), plannedSuggestion()];

  const result = await persistOverridePlansWithDependencies(
    {
      userId: "user-1",
      planned,
      existingRules: [rule],
      now: NOW,
    },
    {
      configured: true,
      insertRows: async (datasetId, tableId, rows) => {
        calls.push({ datasetId, tableId, rows });
        return true;
      },
      getPendingSuggestionsForTransactions: async (input) => {
        assert.deepEqual(input, {
          userId: "user-1",
          transactionIds: ["txn-suggest"],
        });
        return [
          pendingSuggestion(),
          pendingSuggestion({ suggestion_id: "suggestion-keep" }),
          pendingSuggestion({ suggestion_id: "orphan", transaction_id: null }),
        ];
      },
    },
  );

  assert.deepEqual(
    calls.map((call) => call.tableId),
    ["manual_overrides", "category_rules", "category_rule_suggestions"],
  );

  assert.deepEqual(
    calls[0].rows.map((row) => row.transaction_id),
    ["txn-create", "txn-suggest"],
  );

  assert.equal(calls[1].rows.length, 2);
  assert.deepEqual(
    {
      rule_id: calls[1].rows[0].rule_id,
      enabled: calls[1].rows[0].enabled,
      category_id: calls[1].rows[0].category_id,
      created_at: calls[1].rows[0].created_at,
    },
    {
      rule_id: "rule-dining",
      enabled: false,
      category_id: "dining",
      created_at: NOW,
    },
  );
  assert.equal(calls[1].rows[1].rule_id, "rule-create");

  assert.deepEqual(
    calls[2].rows.map((row) => ({
      suggestion_id: row.suggestion_id,
      status: row.status,
      reviewed_at: row.reviewed_at,
    })),
    [
      {
        suggestion_id: "suggestion-old",
        status: "superseded",
        reviewed_at: NOW,
      },
      {
        suggestion_id: "suggestion-keep",
        status: "pending",
        reviewed_at: null,
      },
    ],
  );

  assert.deepEqual(result, [
    {
      transactionId: "txn-create",
      persisted: true,
      rulePersisted: true,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-suggest",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: true,
      ruleSuggestionError: null,
    },
  ]);
});

test("persistOverridePlansWithDependencies reports rule-write failures per affected transaction", async () => {
  const calls = [];
  const rule = existingRule();
  const planned = [plannedCreateWithConflict(rule), plannedSuggestion()];

  const result = await persistOverridePlansWithDependencies(
    {
      userId: "user-1",
      planned,
      existingRules: [rule],
      now: NOW,
    },
    {
      configured: true,
      insertRows: async (datasetId, tableId, rows) => {
        calls.push({ datasetId, tableId, rows });
        if (tableId === "category_rules") {
          throw new Error("rules table unavailable");
        }
        return true;
      },
      getPendingSuggestionsForTransactions: async () => [],
    },
  );

  assert.deepEqual(
    calls.map((call) => call.tableId),
    ["manual_overrides", "category_rules", "category_rule_suggestions"],
  );
  assert.deepEqual(result, [
    {
      transactionId: "txn-create",
      persisted: true,
      rulePersisted: false,
      ruleError: "rules table unavailable",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-suggest",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: true,
      ruleSuggestionError: null,
    },
  ]);
});
