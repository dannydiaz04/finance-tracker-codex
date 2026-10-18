import assert from "node:assert/strict";
import test from "node:test";

import { createPersistOverridePlans } from "../../lib/categorization/override-persistence-core.ts";

const NOW = "2026-08-05T10:00:00.000Z";

function existingRule(overrides = {}) {
  return {
    id: "rule-old",
    name: "Old Groceries",
    description: "Old rule",
    priority: 90,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.8,
    hitRate: 0.4,
    lastMatchedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function plannedOverride(transactionId, planOverrides = {}) {
  return {
    transactionId,
    plan: {
      overrideRow: {
        user_id: "user-1",
        transaction_id: transactionId,
        category_id: "groceries",
        reason: "Saved from review queue.",
        updated_at: NOW,
      },
      ruleRow: null,
      ruleSuggestion: null,
      supersedeRuleId: null,
      ...planOverrides,
    },
  };
}

function suggestionRow(overrides = {}) {
  return {
    user_id: "user-1",
    suggestion_id: "suggestion-new",
    transaction_id: "txn-2",
    priority: 110,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Groceries",
    rule_description: "Learned from manual categorization of Wholefoods.",
    source: "manual_override",
    status: "pending",
    note: null,
    created_at: NOW,
    updated_at: NOW,
    reviewed_at: null,
    ...overrides,
  };
}

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "suggestion-old",
    transaction_id: "txn-2",
    priority: 100,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Dining",
    rule_description: "Existing pending suggestion.",
    source: "ai_enrichment",
    note: "old model",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("persistOverridePlans writes overrides, rule tombstones, and superseded suggestions", async () => {
  const calls = [];
  const pendingRequests = [];
  const ruleRow = {
    user_id: "user-1",
    rule_id: "rule-new",
    name: "Wholefoods -> Groceries",
    description: "Learned from manual categorization of Wholefoods.",
    priority: 110,
    enabled: true,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.95,
    hit_rate: 0,
    last_matched_at: null,
    created_at: NOW,
  };
  const newSuggestion = suggestionRow();

  const persistOverridePlans = createPersistOverridePlans({
    isConfigured: () => true,
    insertRows: async (datasetId, tableId, rows) => {
      calls.push({ datasetId, tableId, rows });
      return true;
    },
    getPendingSuggestionsForTransactions: async (input) => {
      pendingRequests.push(input);
      return [
        pendingSuggestion(),
        pendingSuggestion({ suggestion_id: "suggestion-new" }),
        pendingSuggestion({ suggestion_id: "suggestion-orphan", transaction_id: null }),
      ];
    },
  });

  const result = await persistOverridePlans({
    userId: "user-1",
    now: NOW,
    existingRules: [existingRule()],
    planned: [
      plannedOverride("txn-1", { ruleRow, supersedeRuleId: "rule-old" }),
      plannedOverride("txn-2", { ruleSuggestion: newSuggestion }),
    ],
  });

  assert.deepEqual(pendingRequests, [
    { userId: "user-1", transactionIds: ["txn-2"] },
  ]);
  assert.deepEqual(
    calls.map((call) => call.tableId),
    ["manual_overrides", "category_rules", "category_rule_suggestions"],
  );
  assert.deepEqual(
    calls[0].rows.map((row) => row.transaction_id),
    ["txn-1", "txn-2"],
  );
  assert.deepEqual(
    calls[1].rows.map((row) => [row.rule_id, row.enabled, row.category_id]),
    [
      ["rule-old", false, "dining"],
      ["rule-new", true, "groceries"],
    ],
  );
  assert.deepEqual(
    calls[2].rows.map((row) => [row.suggestion_id, row.status]),
    [
      ["suggestion-old", "superseded"],
      ["suggestion-new", "pending"],
    ],
  );
  assert.equal(calls[2].rows[0].updated_at, NOW);
  assert.equal(calls[2].rows[0].reviewed_at, NOW);
  assert.deepEqual(result, [
    {
      transactionId: "txn-1",
      persisted: true,
      rulePersisted: true,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-2",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: true,
      ruleSuggestionError: null,
    },
  ]);
});

test("persistOverridePlans reports rule write failures without failing manual overrides", async () => {
  const calls = [];
  const persistOverridePlans = createPersistOverridePlans({
    isConfigured: () => true,
    insertRows: async (datasetId, tableId, rows) => {
      calls.push({ datasetId, tableId, rows });
      if (tableId === "category_rules") {
        throw new Error("rules table unavailable");
      }
      return true;
    },
    getPendingSuggestionsForTransactions: async () => [],
  });

  const result = await persistOverridePlans({
    userId: "user-1",
    now: NOW,
    existingRules: [existingRule()],
    planned: [
      plannedOverride("txn-1", {
        ruleRow: {
          user_id: "user-1",
          rule_id: "rule-new",
          enabled: true,
        },
        supersedeRuleId: "rule-old",
      }),
    ],
  });

  assert.deepEqual(
    calls.map((call) => call.tableId),
    ["manual_overrides", "category_rules"],
  );
  assert.deepEqual(result, [
    {
      transactionId: "txn-1",
      persisted: true,
      rulePersisted: false,
      ruleError: "rules table unavailable",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});
