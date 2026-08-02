import assert from "node:assert/strict";
import test from "node:test";

import { persistOverridePlansWithDependencies } from "../../lib/categorization/override-persistence-core.ts";

const NOW = "2026-07-28T00:00:00.000Z";

function overrideRow(transactionId, categoryId = "groceries") {
  return {
    user_id: "user-1",
    transaction_id: transactionId,
    category_id: categoryId,
    reason: "Saved from review queue.",
    updated_at: NOW,
  };
}

function ruleRow(ruleId, categoryId = "groceries") {
  return {
    user_id: "user-1",
    rule_id: ruleId,
    name: "Wholefoods -> Groceries",
    description: "Learned from manual categorization of Wholefoods.",
    priority: 110,
    enabled: true,
    category_id: categoryId,
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.95,
    hit_rate: 0,
    last_matched_at: null,
    created_at: NOW,
  };
}

function ruleSuggestion(suggestionId, transactionId, categoryId = "groceries") {
  return {
    user_id: "user-1",
    suggestion_id: suggestionId,
    transaction_id: transactionId,
    priority: 110,
    category_id: categoryId,
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

function planned(transactionId, planOverrides) {
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
      ...planOverrides,
    },
  };
}

function pendingSuggestion(suggestionId, transactionId) {
  return {
    suggestion_id: suggestionId,
    transaction_id: transactionId,
    priority: 90,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Old Wholefoods -> Dining",
    rule_description: "Old pending suggestion.",
    source: "manual_override",
    note: "old note",
    created_at: "2026-07-27T00:00:00.000Z",
  };
}

function existingRule(overrides = {}) {
  return {
    id: "rule-existing",
    name: "Wholefoods -> Dining",
    description: "Existing contradictory rule.",
    priority: 100,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.8,
    hitRate: 0.4,
    lastMatchedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

function deps({
  configured = true,
  pending = [],
  insert = async () => true,
} = {}) {
  return {
    isBigQueryConfigured: () => configured,
    insertBigQueryRows: insert,
    getPendingSuggestionsForTransactions: async () => pending,
  };
}

test("persistOverridePlans writes overrides, rule tombstones, and stale suggestion cleanup", async () => {
  const calls = [];
  const suggestion = ruleSuggestion("suggestion-kept", "txn-suggest");
  const result = await persistOverridePlansWithDependencies(
    {
      userId: "user-1",
      now: NOW,
      existingRules: [existingRule()],
      planned: [
        planned("txn-create", {
          ruleAction: "create",
          ruleRow: ruleRow("rule-new"),
          supersedeRuleId: "rule-existing",
        }),
        planned("txn-suggest", {
          ruleAction: "suggest",
          ruleSuggestion: suggestion,
        }),
      ],
    },
    deps({
      pending: [
        pendingSuggestion("suggestion-stale", "txn-suggest"),
        pendingSuggestion("suggestion-kept", "txn-suggest"),
      ],
      insert: async (datasetId, tableId, rows) => {
        calls.push({ datasetId, tableId, rows });
        return true;
      },
    }),
  );

  assert.deepEqual(
    calls.map((call) => call.tableId),
    ["manual_overrides", "category_rules", "category_rule_suggestions"],
  );
  assert.deepEqual(calls[0].rows, [overrideRow("txn-create"), overrideRow("txn-suggest")]);

  assert.equal(calls[1].rows.length, 2);
  assert.deepEqual(calls[1].rows[0], {
    user_id: "user-1",
    rule_id: "rule-existing",
    name: "Wholefoods -> Dining",
    description: "Existing contradictory rule.",
    priority: 100,
    enabled: false,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.8,
    hit_rate: 0.4,
    last_matched_at: "2026-07-20T00:00:00.000Z",
    created_at: NOW,
  });
  assert.deepEqual(calls[1].rows[1], ruleRow("rule-new"));

  assert.equal(calls[2].rows.length, 2);
  assert.deepEqual(calls[2].rows[0], {
    user_id: "user-1",
    suggestion_id: "suggestion-stale",
    transaction_id: "txn-suggest",
    priority: 90,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Old Wholefoods -> Dining",
    rule_description: "Old pending suggestion.",
    source: "manual_override",
    status: "superseded",
    note: "old note",
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: NOW,
    reviewed_at: NOW,
  });
  assert.deepEqual(calls[2].rows[1], suggestion);

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

test("persistOverridePlans reports rule insert failures without failing saved overrides", async () => {
  const result = await persistOverridePlansWithDependencies(
    {
      userId: "user-1",
      now: NOW,
      existingRules: [],
      planned: [
        planned("txn-create", {
          ruleAction: "create",
          ruleRow: ruleRow("rule-new"),
        }),
      ],
    },
    deps({
      insert: async (_datasetId, tableId) => {
        if (tableId === "category_rules") {
          throw new Error("category_rules unavailable");
        }
        return true;
      },
    }),
  );

  assert.deepEqual(result, [
    {
      transactionId: "txn-create",
      persisted: true,
      rulePersisted: false,
      ruleError: "category_rules unavailable",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});

test("persistOverridePlans skips warehouse calls when BigQuery is not configured", async () => {
  const calls = [];
  const result = await persistOverridePlansWithDependencies(
    {
      userId: "user-1",
      now: NOW,
      existingRules: [],
      planned: [
        planned("txn-suggest", {
          ruleAction: "suggest",
          ruleSuggestion: ruleSuggestion("suggestion-1", "txn-suggest"),
        }),
      ],
    },
    deps({
      configured: false,
      insert: async (...args) => {
        calls.push(args);
        return true;
      },
    }),
  );

  assert.deepEqual(calls, []);
  assert.deepEqual(result, [
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
