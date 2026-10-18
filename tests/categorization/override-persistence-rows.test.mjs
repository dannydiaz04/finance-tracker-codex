import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverridePersistenceResults,
  buildRulePersistenceRows,
  buildSuggestionPersistenceRows,
} from "../../lib/categorization/override-persistence-rows.ts";

const now = "2026-08-11T10:00:00.000Z";

function rule(overrides = {}) {
  return {
    id: "rule-old",
    name: "Wholefoods -> Dining",
    description: "Legacy rule",
    priority: 95,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.8,
    hitRate: 0.42,
    lastMatchedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function planned({ transactionId = "txn-1", plan = {} } = {}) {
  return {
    transactionId,
    plan: {
      overrideRow: {
        user_id: "user-1",
        transaction_id: transactionId,
        category_id: "groceries",
        reason: "Saved from review queue.",
        updated_at: now,
      },
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
      ...plan,
    },
  };
}

function ruleRow(overrides = {}) {
  return {
    user_id: "user-1",
    rule_id: "rule-new",
    name: "Wholefoods -> Groceries",
    description: "Learned rule",
    priority: 110,
    enabled: true,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.95,
    hit_rate: 0,
    last_matched_at: null,
    created_at: now,
    ...overrides,
  };
}

function suggestionRow(overrides = {}) {
  return {
    user_id: "user-1",
    suggestion_id: "suggestion-keep",
    transaction_id: "txn-1",
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
    created_at: now,
    updated_at: now,
    reviewed_at: null,
    ...overrides,
  };
}

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "suggestion-stale",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Dining",
    rule_description: "Previous pending suggestion.",
    source: "manual_override",
    note: "old note",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("buildRulePersistenceRows disables superseded rules before inserting replacements", () => {
  const rows = buildRulePersistenceRows({
    userId: "user-1",
    existingRules: [rule()],
    now,
    planned: [
      planned({
        plan: {
          supersedeRuleId: "rule-old",
          ruleRow: ruleRow(),
        },
      }),
    ],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.rule_id, row.enabled]),
    [
      ["rule-old", false],
      ["rule-new", true],
    ],
  );
  assert.equal(rows[0].user_id, "user-1");
  assert.equal(rows[0].created_at, now);
  assert.equal(rows[1].category_id, "groceries");
});

test("buildSuggestionPersistenceRows supersedes stale pending rows but keeps the retry identity", () => {
  const rows = buildSuggestionPersistenceRows({
    userId: "user-1",
    now,
    planned: [
      planned({
        plan: {
          ruleAction: "suggest",
          ruleSuggestion: suggestionRow(),
        },
      }),
    ],
    pending: [
      pendingSuggestion(),
      pendingSuggestion({ suggestion_id: "suggestion-keep" }),
      pendingSuggestion({ suggestion_id: "missing-transaction", transaction_id: null }),
    ],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.suggestion_id, row.status]),
    [
      ["suggestion-stale", "superseded"],
      ["suggestion-keep", "pending"],
    ],
  );
  assert.equal(rows[0].reviewed_at, now);
  assert.equal(rows[0].updated_at, now);
  assert.equal(rows[1].reviewed_at, null);
});

test("buildOverridePersistenceResults attaches partial errors only to rows with matching writes", () => {
  const results = buildOverridePersistenceResults({
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "category_rules unavailable",
    suggestionRowsPersisted: true,
    ruleSuggestionError: null,
    planned: [
      planned({
        transactionId: "txn-rule",
        plan: { ruleRow: ruleRow({ rule_id: "rule-write" }) },
      }),
      planned({
        transactionId: "txn-suggestion",
        plan: { ruleSuggestion: suggestionRow({ transaction_id: "txn-suggestion" }) },
      }),
      planned({
        transactionId: "txn-override-only",
      }),
    ],
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-rule",
      persisted: true,
      rulePersisted: false,
      ruleError: "category_rules unavailable",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-suggestion",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: true,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-override-only",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});
