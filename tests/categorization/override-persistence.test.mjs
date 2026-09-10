import assert from "node:assert/strict";
import test from "node:test";

import { createOverridePlansPersister } from "../../lib/categorization/override-persistence.ts";

const now = "2026-08-04T12:00:00.000Z";

function existingRule(overrides = {}) {
  return {
    id: "rule-old",
    name: "Old Cafe rule",
    description: "Previously learned cafe rule.",
    priority: 110,
    enabled: true,
    categoryId: "coffee",
    categoryLabel: "Coffee",
    matchStrategy: "merchant_contains",
    matchValue: "cafe",
    confidenceBoost: 0.95,
    hitRate: 0.7,
    lastMatchedAt: null,
    ...overrides,
  };
}

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "suggestion-stale",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "coffee",
    category_label: "Coffee",
    match_strategy: "merchant_contains",
    match_value: "cafe",
    rule_name: "Cafe -> Coffee",
    rule_description: "Categorize cafe transactions as Coffee.",
    source: "manual_override",
    note: "outdated suggestion",
    created_at: "2026-08-03T12:00:00.000Z",
    ...overrides,
  };
}

function plannedOverride({ transactionId = "txn-1", ...overrides } = {}) {
  return {
    transactionId,
    plan: {
      overrideRow: {
        user_id: "user-1",
        transaction_id: transactionId,
        category_id: "dining",
        category_label: "Dining",
        reason: "Manual review",
        created_at: now,
      },
      supersedeRuleId: null,
      ruleRow: null,
      ruleSuggestion: null,
      ...overrides,
    },
  };
}

function recordingDeps({ pending = [], failTables = new Set() } = {}) {
  const inserts = [];
  const pendingRequests = [];

  return {
    inserts,
    pendingRequests,
    deps: {
      isBigQueryConfigured: () => true,
      async insertBigQueryRows(datasetId, tableId, rows) {
        inserts.push({ datasetId, tableId, rows });
        if (failTables.has(tableId)) {
          throw new Error(`${tableId} unavailable`);
        }
        return true;
      },
      async getPendingSuggestionsForTransactions(input) {
        pendingRequests.push(input);
        return pending;
      },
    },
  };
}

test("persistOverridePlans writes overrides, corrected rules, and stale suggestion tombstones", async () => {
  const ruleRow = {
    user_id: "user-1",
    rule_id: "rule-new",
    name: "Cafe -> Dining",
    description: "Categorize cafe transactions as Dining.",
    priority: 110,
    enabled: true,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "cafe",
    confidence_boost: 0.95,
    hit_rate: 0,
    last_matched_at: null,
    created_at: now,
  };
  const suggestionRow = {
    user_id: "user-1",
    suggestion_id: "suggestion-new",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "cafe",
    rule_name: "Cafe -> Dining",
    rule_description: "Categorize cafe transactions as Dining.",
    source: "manual_override",
    status: "pending",
    note: null,
    created_at: now,
    updated_at: now,
    reviewed_at: null,
  };
  const planned = [
    plannedOverride({
      supersedeRuleId: "rule-old",
      ruleRow,
      ruleSuggestion: suggestionRow,
    }),
  ];
  const { deps, inserts, pendingRequests } = recordingDeps({
    pending: [
      pendingSuggestion(),
      pendingSuggestion({ suggestion_id: "suggestion-new", category_id: "dining" }),
      pendingSuggestion({ suggestion_id: "suggestion-unscoped", transaction_id: null }),
    ],
  });

  const result = await createOverridePlansPersister(deps)({
    userId: "user-1",
    planned,
    existingRules: [existingRule()],
    now,
  });

  assert.deepEqual(pendingRequests, [
    { userId: "user-1", transactionIds: ["txn-1"] },
  ]);
  assert.deepEqual(
    inserts.map(({ datasetId, tableId }) => `${datasetId}.${tableId}`),
    [
      "ops_finance.manual_overrides",
      "ops_finance.category_rules",
      "ops_finance.category_rule_suggestions",
    ],
  );
  assert.deepEqual(inserts[0].rows, [planned[0].plan.overrideRow]);
  assert.deepEqual(inserts[1].rows, [
    {
      user_id: "user-1",
      rule_id: "rule-old",
      name: "Old Cafe rule",
      description: "Previously learned cafe rule.",
      priority: 110,
      enabled: false,
      category_id: "coffee",
      category_label: "Coffee",
      match_strategy: "merchant_contains",
      match_value: "cafe",
      confidence_boost: 0.95,
      hit_rate: 0.7,
      last_matched_at: null,
      created_at: now,
    },
    ruleRow,
  ]);
  assert.deepEqual(inserts[2].rows, [
    {
      user_id: "user-1",
      suggestion_id: "suggestion-stale",
      transaction_id: "txn-1",
      priority: 110,
      category_id: "coffee",
      category_label: "Coffee",
      match_strategy: "merchant_contains",
      match_value: "cafe",
      rule_name: "Cafe -> Coffee",
      rule_description: "Categorize cafe transactions as Coffee.",
      source: "manual_override",
      status: "superseded",
      note: "outdated suggestion",
      created_at: "2026-08-03T12:00:00.000Z",
      updated_at: now,
      reviewed_at: now,
    },
    suggestionRow,
  ]);
  assert.deepEqual(result, [
    {
      transactionId: "txn-1",
      persisted: true,
      rulePersisted: true,
      ruleError: null,
      ruleSuggestionPersisted: true,
      ruleSuggestionError: null,
    },
  ]);
});

test("persistOverridePlans reports rule-write failures without failing saved overrides or suggestions", async () => {
  const planned = [
    plannedOverride({
      ruleRow: {
        rule_id: "rule-new",
        category_id: "dining",
      },
      ruleSuggestion: {
        suggestion_id: "suggestion-new",
        transaction_id: "txn-1",
      },
    }),
    plannedOverride({
      transactionId: "txn-2",
      overrideRow: {
        user_id: "user-1",
        transaction_id: "txn-2",
        category_id: "groceries",
        category_label: "Groceries",
        reason: "Manual review",
        created_at: now,
      },
    }),
  ];
  const { deps, inserts } = recordingDeps({
    failTables: new Set(["category_rules"]),
  });

  const result = await createOverridePlansPersister(deps)({
    userId: "user-1",
    planned,
    existingRules: [],
    now,
  });

  assert.deepEqual(
    inserts.map(({ tableId }) => tableId),
    ["manual_overrides", "category_rules", "category_rule_suggestions"],
  );
  assert.deepEqual(inserts[0].rows, [
    planned[0].plan.overrideRow,
    planned[1].plan.overrideRow,
  ]);
  assert.deepEqual(result, [
    {
      transactionId: "txn-1",
      persisted: true,
      rulePersisted: false,
      ruleError: "category_rules unavailable",
      ruleSuggestionPersisted: true,
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
