import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverridePersistenceResults,
  buildRulePersistenceRows,
  buildSuggestionPersistenceRows,
} from "../../lib/categorization/override-persistence-plan.ts";

const NOW = "2026-08-01T10:00:00.000Z";
const USER_ID = "user-1";

const existingRule = {
  id: "rule-old",
  name: "Old coffee rule",
  description: "Categorize coffee purchases.",
  priority: 110,
  enabled: true,
  categoryId: "coffee",
  categoryLabel: "Coffee",
  matchStrategy: "merchant_contains",
  matchValue: "coffee shop",
  confidenceBoost: 0.95,
  hitRate: 0.42,
  lastMatchedAt: "2026-07-31T12:00:00.000Z",
};

function planned(transactionId, planOverrides = {}) {
  return {
    transactionId,
    plan: {
      overrideRow: {
        user_id: USER_ID,
        transaction_id: transactionId,
        category_id: "dining",
        reason: "Saved from review queue.",
        updated_at: NOW,
      },
      ruleRow: null,
      supersedeRuleId: null,
      ruleSuggestion: null,
      ...planOverrides,
    },
  };
}

function suggestionRow(overrides = {}) {
  return {
    user_id: USER_ID,
    suggestion_id: "suggestion-keep",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "coffee shop",
    rule_name: "Coffee Shop -> Dining",
    rule_description: "Learned from manual categorization of Coffee Shop.",
    source: "manual_override",
    status: "pending",
    note: null,
    created_at: NOW,
    updated_at: NOW,
    reviewed_at: null,
    ...overrides,
  };
}

test("rule persistence rows disable a superseded rule before writing its replacement", () => {
  const rows = buildRulePersistenceRows({
    userId: USER_ID,
    now: NOW,
    existingRules: [existingRule],
    planned: [
      planned("txn-1", {
        supersedeRuleId: "rule-old",
        ruleRow: {
          user_id: USER_ID,
          rule_id: "rule-new",
          enabled: true,
          category_id: "dining",
          match_strategy: "merchant_contains",
          match_value: "coffee shop",
          created_at: NOW,
        },
      }),
    ],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.rule_id),
    ["rule-old", "rule-new"],
  );
  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].category_id, "coffee");
  assert.equal(rows[0].last_matched_at, existingRule.lastMatchedAt);
  assert.equal(rows[0].created_at, NOW);
  assert.equal(rows[1].enabled, true);
});

test("suggestion rows supersede stale pending suggestions but keep the reviewed one", () => {
  const rows = buildSuggestionPersistenceRows({
    userId: USER_ID,
    now: NOW,
    planned: [
      planned("txn-1", {
        ruleSuggestion: suggestionRow({ suggestion_id: "suggestion-keep" }),
      }),
    ],
    pending: [
      {
        suggestion_id: "suggestion-stale",
        transaction_id: "txn-1",
        priority: 100,
        category_id: "coffee",
        category_label: "Coffee",
        match_strategy: "merchant_contains",
        match_value: "coffee",
        rule_name: "Coffee -> Coffee",
        rule_description: "Old pending suggestion.",
        source: "manual_override",
        note: "old",
        created_at: "2026-07-30T10:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-keep",
        transaction_id: "txn-1",
        priority: 110,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "coffee shop",
        rule_name: "Coffee Shop -> Dining",
        rule_description: "Current pending suggestion.",
        source: "manual_override",
        note: null,
        created_at: "2026-07-31T10:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-other-transaction",
        transaction_id: "txn-other",
        priority: 110,
        category_id: "travel",
        category_label: "Travel",
        match_strategy: "merchant_contains",
        match_value: "airline",
        rule_name: "Airline -> Travel",
        rule_description: "Unrelated pending suggestion.",
        source: "manual_override",
        note: null,
        created_at: "2026-07-31T10:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.suggestion_id),
    ["suggestion-stale", "suggestion-keep"],
  );
  assert.equal(rows[0].status, "superseded");
  assert.equal(rows[0].reviewed_at, NOW);
  assert.equal(rows[0].updated_at, NOW);
  assert.equal(rows[1].status, "pending");
});

test("persistence results report partial write failures only for affected batch items", () => {
  const results = buildOverridePersistenceResults({
    planned: [
      planned("txn-override-only"),
      planned("txn-rule", {
        ruleRow: { rule_id: "rule-new" },
      }),
      planned("txn-suggestion", {
        ruleSuggestion: suggestionRow({ transaction_id: "txn-suggestion" }),
      }),
    ],
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "rule write failed",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "suggestion write failed",
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-override-only",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-rule",
      persisted: true,
      rulePersisted: false,
      ruleError: "rule write failed",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-suggestion",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: "suggestion write failed",
    },
  ]);
});
