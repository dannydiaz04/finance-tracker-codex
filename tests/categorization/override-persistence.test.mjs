import assert from "node:assert/strict";
import test from "node:test";

import { createOverridePlanPersister } from "../../lib/categorization/override-persistence-core.ts";

const NOW = "2026-07-27T20:00:00.000Z";

function overrideRow(transactionId) {
  return {
    user_id: "user-1",
    transaction_id: transactionId,
    category_id: "groceries",
    reason: "Saved from review queue.",
    updated_at: NOW,
  };
}

function ruleRow(ruleId) {
  return {
    user_id: "user-1",
    rule_id: ruleId,
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
}

function suggestionRow(suggestionId, transactionId) {
  return {
    user_id: "user-1",
    suggestion_id: suggestionId,
    transaction_id: transactionId,
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
  };
}

function plan(transactionId, overrides = {}) {
  return {
    transactionId,
    plan: {
      overrideRow: overrideRow(transactionId),
      ruleAction: "none",
      ruleSuggestion: null,
      ruleRow: null,
      supersedeRuleId: null,
      dedupe: "new",
      conflictCategoryId: null,
      matchPreview: null,
      match: null,
      guardrailNote: null,
      categoryChanged: true,
      ...overrides,
    },
  };
}

function existingRule(overrides = {}) {
  return {
    id: "rule-old",
    name: "Wholefoods -> Dining",
    description: "Old learned rule.",
    priority: 110,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.95,
    hitRate: 7,
    lastMatchedAt: "2026-07-20",
    ...overrides,
  };
}

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "stale-suggestion",
    transaction_id: "txn-suggest",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Dining",
    rule_description: "Stale review queue suggestion.",
    source: "manual_override",
    note: "old guess",
    created_at: "2026-07-27T19:00:00.000Z",
    ...overrides,
  };
}

test("persistOverridePlans: groups override, rule, tombstone, and suggestion writes", async () => {
  const calls = [];
  const persistOverridePlans = createOverridePlanPersister({
    isBigQueryConfigured: () => true,
    insertBigQueryRows: async (datasetId, tableId, rows) => {
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
  });

  const results = await persistOverridePlans({
    userId: "user-1",
    now: NOW,
    existingRules: [existingRule()],
    planned: [
      plan("txn-create", {
        ruleAction: "create",
        ruleRow: ruleRow("rule-new"),
        supersedeRuleId: "rule-old",
      }),
      plan("txn-suggest", {
        ruleAction: "suggest",
        ruleSuggestion: suggestionRow("suggestion-keep", "txn-suggest"),
      }),
    ],
  });

  assert.deepEqual(
    calls.map((call) => [call.datasetId, call.tableId, call.rows.length]),
    [
      ["ops_finance", "manual_overrides", 2],
      ["ops_finance", "category_rules", 2],
      ["ops_finance", "category_rule_suggestions", 2],
    ],
  );
  assert.deepEqual(calls[0].rows.map((row) => row.transaction_id), [
    "txn-create",
    "txn-suggest",
  ]);
  assert.deepEqual(
    calls[1].rows.map((row) => [row.rule_id, row.enabled, row.category_id]),
    [
      ["rule-old", false, "dining"],
      ["rule-new", true, "groceries"],
    ],
  );
  assert.equal(calls[1].rows[0].last_matched_at, "2026-07-20");
  assert.deepEqual(
    calls[2].rows.map((row) => [row.suggestion_id, row.status, row.reviewed_at]),
    [
      ["stale-suggestion", "superseded", NOW],
      ["suggestion-keep", "pending", null],
    ],
  );
  assert.deepEqual(results, [
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

test("persistOverridePlans: skips warehouse work when BigQuery is not configured", async () => {
  const persistOverridePlans = createOverridePlanPersister({
    isBigQueryConfigured: () => false,
    insertBigQueryRows: async () => {
      throw new Error("insert should not be called");
    },
    getPendingSuggestionsForTransactions: async () => {
      throw new Error("pending suggestions should not be loaded");
    },
  });

  const results = await persistOverridePlans({
    userId: "user-1",
    now: NOW,
    existingRules: [existingRule()],
    planned: [
      plan("txn-create", {
        ruleAction: "create",
        ruleRow: ruleRow("rule-new"),
        supersedeRuleId: "rule-old",
      }),
      plan("txn-suggest", {
        ruleAction: "suggest",
        ruleSuggestion: suggestionRow("suggestion-keep", "txn-suggest"),
      }),
    ],
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-create",
      persisted: false,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-suggest",
      persisted: false,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});

test("persistOverridePlans: reports rule write failures without blocking suggestions", async () => {
  const calls = [];
  const persistOverridePlans = createOverridePlanPersister({
    isBigQueryConfigured: () => true,
    insertBigQueryRows: async (datasetId, tableId, rows) => {
      calls.push({ datasetId, tableId, rows });
      if (tableId === "category_rules") {
        throw new Error("rule write failed");
      }
      return true;
    },
    getPendingSuggestionsForTransactions: async () => {
      throw new Error("pending lookup failed");
    },
  });

  const results = await persistOverridePlans({
    userId: "user-1",
    now: NOW,
    existingRules: [existingRule()],
    planned: [
      plan("txn-create", {
        ruleAction: "create",
        ruleRow: ruleRow("rule-new"),
        supersedeRuleId: "rule-old",
      }),
      plan("txn-suggest", {
        ruleAction: "suggest",
        ruleSuggestion: suggestionRow("suggestion-keep", "txn-suggest"),
      }),
    ],
  });

  assert.deepEqual(
    calls.map((call) => [call.tableId, call.rows.length]),
    [
      ["manual_overrides", 2],
      ["category_rules", 2],
      ["category_rule_suggestions", 1],
    ],
  );
  assert.equal(calls[2].rows[0].suggestion_id, "suggestion-keep");
  assert.deepEqual(results, [
    {
      transactionId: "txn-create",
      persisted: true,
      rulePersisted: false,
      ruleError: "rule write failed",
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
