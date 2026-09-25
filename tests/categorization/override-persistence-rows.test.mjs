import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverrideRuleRows,
  buildOverrideSuggestionRows,
  summarizeOverridePersistenceResults,
} from "../../lib/categorization/override-persistence-rows.ts";
import { planOverride } from "../../lib/categorization/override-plan.ts";

const NOW = "2026-06-22T00:00:00.000Z";
const USER_ID = "user-1";
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

function financeRule(overrides = {}) {
  return {
    id: "rule-existing",
    name: "Wholefoods -> Dining",
    description: "Old dining rule.",
    priority: 110,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.95,
    hitRate: 0.5,
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

function planItem({
  transaction = baseTransaction(),
  category = groceries,
  action = "create",
  existingRules = [],
  suggestionId = `suggestion-${transaction.transactionId}`,
  ruleId = `rule-${transaction.transactionId}`,
} = {}) {
  return {
    transactionId: transaction.transactionId,
    plan: planOverride({
      userId: USER_ID,
      transaction,
      category,
      action,
      existingRules,
      now: NOW,
      suggestionId,
      ruleId,
    }),
  };
}

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "suggestion-old",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Dining",
    rule_description: "Old suggestion.",
    source: "manual_override",
    note: "old note",
    created_at: "2026-06-21T00:00:00.000Z",
    ...overrides,
  };
}

test("rule rows disable a conflicting existing rule before writing its replacement", () => {
  const existing = financeRule();
  const planned = [
    planItem({
      existingRules: [toExistingRule(existing)],
      ruleId: "rule-new",
    }),
  ];

  const rows = buildOverrideRuleRows({
    userId: USER_ID,
    planned,
    existingRules: [existing],
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].rule_id, "rule-existing");
  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].category_id, "dining");
  assert.equal(rows[0].created_at, NOW);
  assert.equal(rows[1].rule_id, "rule-new");
  assert.equal(rows[1].enabled, true);
  assert.equal(rows[1].category_id, "groceries");
});

test("suggestion rows supersede stale pending suggestions and keep the retry id", () => {
  const planned = [
    planItem({
      action: "suggest",
      suggestionId: "suggestion-keep",
    }),
  ];

  const rows = buildOverrideSuggestionRows({
    userId: USER_ID,
    planned,
    pendingSuggestions: [
      pendingSuggestion(),
      pendingSuggestion({ suggestion_id: "suggestion-keep" }),
    ],
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].suggestion_id, "suggestion-old");
  assert.equal(rows[0].status, "superseded");
  assert.equal(rows[0].updated_at, NOW);
  assert.equal(rows[0].reviewed_at, NOW);
  assert.equal(rows[1].suggestion_id, "suggestion-keep");
  assert.equal(rows[1].status, "pending");
});

test("persistence summary attributes partial table failures only to affected plans", () => {
  const create = planItem({
    transaction: baseTransaction({ transactionId: "txn-create" }),
    action: "create",
  });
  const suggest = planItem({
    transaction: baseTransaction({
      transactionId: "txn-suggest",
      merchantRaw: "TARGET 100",
      merchantNorm: "target",
      descriptionNorm: "target store",
    }),
    action: "suggest",
  });
  const none = planItem({
    transaction: baseTransaction({
      transactionId: "txn-none",
      merchantRaw: "KROGER",
      merchantNorm: "kroger",
      descriptionNorm: "kroger",
    }),
    action: "none",
  });

  const results = summarizeOverridePersistenceResults({
    planned: [create, suggest, none],
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "category_rules unavailable",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "category_rule_suggestions unavailable",
  });
  const byId = new Map(results.map((result) => [result.transactionId, result]));

  assert.deepEqual(byId.get("txn-create"), {
    transactionId: "txn-create",
    persisted: true,
    rulePersisted: false,
    ruleError: "category_rules unavailable",
    ruleSuggestionPersisted: false,
    ruleSuggestionError: null,
  });
  assert.deepEqual(byId.get("txn-suggest"), {
    transactionId: "txn-suggest",
    persisted: true,
    rulePersisted: false,
    ruleError: null,
    ruleSuggestionPersisted: false,
    ruleSuggestionError: "category_rule_suggestions unavailable",
  });
  assert.deepEqual(byId.get("txn-none"), {
    transactionId: "txn-none",
    persisted: true,
    rulePersisted: false,
    ruleError: null,
    ruleSuggestionPersisted: false,
    ruleSuggestionError: null,
  });
});
