import assert from "node:assert/strict";
import test from "node:test";

import { createOverridePlanPersister } from "../../lib/categorization/override-persistence.ts";

const now = "2026-08-30T10:00:00.000Z";

function createRecorder({ configured = true, pending = [], failTable = null } = {}) {
  const calls = [];
  const persister = createOverridePlanPersister({
    isConfigured: () => configured,
    insertRows: async (datasetId, tableId, rows) => {
      calls.push({ datasetId, tableId, rows });
      if (tableId === failTable) {
        throw new Error(`${tableId} failed`);
      }
      return true;
    },
    getPendingSuggestions: async (input) => {
      calls.push({ tableId: "pending_suggestions", input });
      return pending;
    },
  });

  return { calls, persister };
}

function planned(transactionId, plan = {}) {
  return {
    transactionId,
    plan: {
      overrideRow: {
        user_id: "user-1",
        transaction_id: transactionId,
        category_id: "groceries",
      },
      ruleRow: null,
      supersedeRuleId: null,
      ruleSuggestion: null,
      ...plan,
    },
  };
}

function existingRule(overrides = {}) {
  return {
    id: "rule-old",
    name: "Old grocery rule",
    description: "Old learned rule",
    priority: 110,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.95,
    hitRate: 0.5,
    lastMatchedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function suggestion(overrides = {}) {
  return {
    suggestion_id: "suggestion-new",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Groceries",
    rule_description: "Learned from manual categorization.",
    source: "manual_override",
    note: null,
    created_at: now,
    ...overrides,
  };
}

test("persistOverridePlans writes manual overrides without rule side effects", async () => {
  const { calls, persister } = createRecorder();

  const result = await persister({
    userId: "user-1",
    planned: [planned("txn-1"), planned("txn-2")],
    existingRules: [],
    now,
  });

  assert.deepEqual(
    calls.map((call) => call.tableId),
    ["manual_overrides"],
  );
  assert.equal(calls[0].datasetId, "ops_finance");
  assert.deepEqual(
    calls[0].rows.map((row) => row.transaction_id),
    ["txn-1", "txn-2"],
  );
  assert.deepEqual(result, [
    {
      transactionId: "txn-1",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-2",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});

test("persistOverridePlans tombstones superseded rules before inserting replacements", async () => {
  const { calls, persister } = createRecorder();
  const newRule = {
    rule_id: "rule-new",
    name: "New grocery rule",
    enabled: true,
    category_id: "groceries",
  };

  const result = await persister({
    userId: "user-1",
    planned: [
      planned("txn-1", {
        supersedeRuleId: "rule-old",
        ruleRow: newRule,
      }),
    ],
    existingRules: [existingRule()],
    now,
  });

  const ruleCall = calls.find((call) => call.tableId === "category_rules");
  assert.ok(ruleCall);
  assert.equal(ruleCall.datasetId, "ops_finance");
  assert.deepEqual(ruleCall.rows, [
    {
      user_id: "user-1",
      rule_id: "rule-old",
      name: "Old grocery rule",
      description: "Old learned rule",
      priority: 110,
      enabled: false,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "wholefoods",
      confidence_boost: 0.95,
      hit_rate: 0.5,
      last_matched_at: "2026-08-01T00:00:00.000Z",
      created_at: now,
    },
    newRule,
  ]);
  assert.equal(result[0].persisted, true);
  assert.equal(result[0].rulePersisted, true);
  assert.equal(result[0].ruleError, null);
});

test("persistOverridePlans supersedes stale pending suggestions for the same transactions", async () => {
  const stale = suggestion({
    suggestion_id: "suggestion-stale",
    category_id: "dining",
    category_label: "Dining",
    created_at: "2026-08-20T00:00:00.000Z",
  });
  const kept = suggestion({ suggestion_id: "suggestion-new" });
  const unrelatedNullTransaction = suggestion({
    suggestion_id: "suggestion-null",
    transaction_id: null,
  });
  const { calls, persister } = createRecorder({
    pending: [stale, kept, unrelatedNullTransaction],
  });

  const result = await persister({
    userId: "user-1",
    planned: [planned("txn-1", { ruleSuggestion: kept })],
    existingRules: [],
    now,
  });

  const pendingCall = calls.find((call) => call.tableId === "pending_suggestions");
  assert.deepEqual(pendingCall.input, {
    userId: "user-1",
    transactionIds: ["txn-1"],
  });

  const suggestionCall = calls.find(
    (call) => call.tableId === "category_rule_suggestions",
  );
  assert.deepEqual(
    suggestionCall.rows.map((row) => row.suggestion_id),
    ["suggestion-stale", "suggestion-new"],
  );
  assert.deepEqual(suggestionCall.rows[0], {
    user_id: "user-1",
    suggestion_id: "suggestion-stale",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Groceries",
    rule_description: "Learned from manual categorization.",
    source: "manual_override",
    status: "superseded",
    note: null,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: now,
    reviewed_at: now,
  });
  assert.equal(result[0].ruleSuggestionPersisted, true);
  assert.equal(result[0].ruleSuggestionError, null);
});

test("persistOverridePlans reports rule failures without rolling back overrides", async () => {
  const { persister } = createRecorder({ failTable: "category_rules" });

  const result = await persister({
    userId: "user-1",
    planned: [
      planned("txn-1", {
        ruleRow: {
          rule_id: "rule-new",
          enabled: true,
        },
      }),
    ],
    existingRules: [],
    now,
  });

  assert.deepEqual(result, [
    {
      transactionId: "txn-1",
      persisted: true,
      rulePersisted: false,
      ruleError: "category_rules failed",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});

test("persistOverridePlans does not call BigQuery dependencies in sample mode", async () => {
  const { calls, persister } = createRecorder({ configured: false });

  const result = await persister({
    userId: "user-1",
    planned: [
      planned("txn-1", {
        ruleRow: { rule_id: "rule-new" },
        ruleSuggestion: suggestion(),
      }),
    ],
    existingRules: [existingRule()],
    now,
  });

  assert.deepEqual(calls, []);
  assert.deepEqual(result, [
    {
      transactionId: "txn-1",
      persisted: false,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});
