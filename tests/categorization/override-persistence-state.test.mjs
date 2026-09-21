import assert from "node:assert/strict";
import test from "node:test";

import { planOverride, resolveRuleAction } from "../../lib/categorization/override-plan.ts";
import {
  buildRulePersistenceRows,
  buildSuggestionPersistenceRows,
  mapOverridePersistenceResults,
} from "../../lib/categorization/override-persistence-state.ts";

const NOW = "2026-07-28T00:00:00.000Z";
const groceries = { id: "groceries", label: "Groceries" };
const dining = { id: "dining", label: "Dining" };

function transaction(overrides = {}) {
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
    description: "Old merchant rule.",
    priority: 90,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.8,
    hitRate: 12,
    lastMatchedAt: "2026-07-01T00:00:00.000Z",
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

function plannedOverride({
  transactionId,
  merchantNorm = "wholefoods",
  category = groceries,
  action = "create",
  existingRules = [],
}) {
  return {
    transactionId,
    plan: planOverride({
      userId: "user-1",
      transaction: transaction({
        transactionId,
        merchantRaw: merchantNorm,
        merchantNorm,
        descriptionNorm: `${merchantNorm} purchase`,
      }),
      category,
      action: resolveRuleAction({ ruleAction: action }),
      existingRules,
      now: NOW,
      suggestionId: `suggestion-${transactionId}`,
      ruleId: `rule-${transactionId}`,
    }),
  };
}

test("rule persistence rows disable the superseded rule before appending the learned rule", () => {
  const oldRule = existingRule();
  const planned = [
    plannedOverride({
      transactionId: "txn-1",
      category: groceries,
      action: "create",
      existingRules: [toExistingRule(oldRule)],
    }),
  ];

  const rows = buildRulePersistenceRows({
    planned,
    existingRules: [oldRule],
    userId: "user-1",
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    user_id: "user-1",
    rule_id: "rule-dining",
    name: "Wholefoods -> Dining",
    description: "Old merchant rule.",
    priority: 90,
    enabled: false,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.8,
    hit_rate: 12,
    last_matched_at: "2026-07-01T00:00:00.000Z",
    created_at: NOW,
  });
  assert.equal(rows[1].rule_id, "rule-txn-1");
  assert.equal(rows[1].category_id, "groceries");
  assert.equal(rows[1].enabled, true);
});

test("suggestion persistence rows supersede stale suggestions but keep the current retry id", () => {
  const planned = [
    plannedOverride({ transactionId: "txn-1", action: "suggest" }),
    plannedOverride({
      transactionId: "txn-2",
      merchantNorm: "trader joes",
      action: "suggest",
    }),
  ];

  const rows = buildSuggestionPersistenceRows({
    userId: "user-1",
    planned,
    now: NOW,
    pendingSuggestions: [
      pendingSuggestion({ suggestion_id: "stale-txn-1", transaction_id: "txn-1" }),
      pendingSuggestion({ suggestion_id: "suggestion-txn-1", transaction_id: "txn-1" }),
      pendingSuggestion({ suggestion_id: "stale-txn-2", transaction_id: "txn-2" }),
      pendingSuggestion({ suggestion_id: "orphan", transaction_id: null }),
    ],
  });

  const superseded = rows.filter((row) => row.status === "superseded");
  assert.deepEqual(
    superseded.map((row) => row.suggestion_id),
    ["stale-txn-1", "stale-txn-2"],
  );
  assert.ok(
    superseded.every(
      (row) => row.updated_at === NOW && row.reviewed_at === NOW,
    ),
  );
  assert.deepEqual(
    rows.filter((row) => row.status === "pending").map((row) => row.suggestion_id),
    ["suggestion-txn-1", "suggestion-txn-2"],
  );
});

test("persistence result mapping scopes partial failures to rows that attempted that write", () => {
  const planned = [
    plannedOverride({ transactionId: "txn-rule", action: "create" }),
    plannedOverride({
      transactionId: "txn-suggestion",
      merchantNorm: "trader joes",
      action: "suggest",
    }),
    plannedOverride({
      transactionId: "txn-override-only",
      merchantNorm: "parking meter",
      category: dining,
      action: "none",
    }),
  ];

  const results = mapOverridePersistenceResults({
    planned,
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "rule insert failed",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "suggestion insert failed",
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-rule",
      persisted: true,
      rulePersisted: false,
      ruleError: "rule insert failed",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-suggestion",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: "suggestion insert failed",
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

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "suggestion-1",
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
    created_at: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}
