import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRulePersistenceRows,
  buildRuleSuggestionPersistenceRows,
  summarizeOverridePersistenceResults,
} from "../../lib/categorization/override-persistence-rows.ts";
import { planOverride } from "../../lib/categorization/override-plan.ts";

const NOW = "2026-08-03T10:00:00.000Z";
const userId = "user-1";
const groceries = { id: "groceries", label: "Groceries" };
const dining = { id: "dining", label: "Dining" };

const activeDiningRule = {
  id: "rule-dining",
  name: "Wholefoods -> Dining",
  description: "Old incorrect rule.",
  priority: 110,
  enabled: true,
  categoryId: "dining",
  categoryLabel: "Dining",
  matchStrategy: "merchant_contains",
  matchValue: "wholefoods",
  confidenceBoost: 0.95,
  hitRate: 0.4,
  lastMatchedAt: "2026-08-01T12:00:00.000Z",
};

function transaction(overrides = {}) {
  return {
    transactionId: "txn-1",
    merchantRaw: "WholeFoods #123",
    merchantNorm: "wholefoods",
    descriptionNorm: "wholefoods groceries",
    transactionClass: "expense",
    derivedCategoryId: "uncategorized",
    ...overrides,
  };
}

function plannedOverride({
  transactionId = "txn-1",
  category = groceries,
  action = "create",
  existingRules = [],
} = {}) {
  return {
    transactionId,
    plan: planOverride({
      userId,
      transaction: transaction({ transactionId }),
      category,
      action,
      existingRules,
      now: NOW,
      suggestionId: `suggestion-${transactionId}`,
      ruleId: `rule-${transactionId}`,
    }),
  };
}

test("rule persistence rows disable a conflicting rule before appending the replacement", () => {
  const planned = plannedOverride({
    existingRules: [
      {
        ruleId: activeDiningRule.id,
        matchStrategy: activeDiningRule.matchStrategy,
        matchValue: activeDiningRule.matchValue,
        categoryId: activeDiningRule.categoryId,
        enabled: activeDiningRule.enabled,
      },
    ],
  });

  const rows = buildRulePersistenceRows({
    userId,
    planned: [planned],
    existingRules: [activeDiningRule],
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.rule_id, row.enabled, row.category_id]),
    [
      ["rule-dining", false, "dining"],
      ["rule-txn-1", true, "groceries"],
    ],
  );
  assert.equal(rows[0].hit_rate, activeDiningRule.hitRate);
  assert.equal(rows[0].last_matched_at, activeDiningRule.lastMatchedAt);
  assert.equal(rows[0].created_at, NOW);
});

test("suggestion persistence rows supersede stale pending suggestions but keep the retried id", () => {
  const planned = plannedOverride({
    transactionId: "txn-2",
    category: dining,
    action: "suggest",
  });

  const rows = buildRuleSuggestionPersistenceRows({
    userId,
    suggestionPlans: [planned],
    pendingSuggestions: [
      {
        suggestion_id: "old-suggestion",
        transaction_id: "txn-2",
        priority: 100,
        category_id: "travel",
        category_label: "Travel",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Travel",
        rule_description: "Old pending suggestion.",
        source: "manual_override",
        note: "stale",
        created_at: "2026-08-01T10:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-txn-2",
        transaction_id: "txn-2",
        priority: 110,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Dining",
        rule_description: "Retry of the same suggestion.",
        source: "manual_override",
        note: null,
        created_at: "2026-08-02T10:00:00.000Z",
      },
      {
        suggestion_id: "orphan-suggestion",
        transaction_id: null,
        priority: 110,
        category_id: "fees",
        category_label: "Fees",
        match_strategy: "merchant_contains",
        match_value: "fees",
        rule_name: "Fees",
        rule_description: "No transaction id to compare.",
        source: "manual_override",
        note: null,
        created_at: "2026-08-02T11:00:00.000Z",
      },
    ],
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].suggestion_id, "old-suggestion");
  assert.equal(rows[0].status, "superseded");
  assert.equal(rows[0].updated_at, NOW);
  assert.equal(rows[0].reviewed_at, NOW);
  assert.equal(rows[1].suggestion_id, "suggestion-txn-2");
  assert.equal(rows[1].status, "pending");
});

test("persistence summaries attach partial write errors only to affected plans", () => {
  const createPlan = plannedOverride({
    existingRules: [
      {
        ruleId: activeDiningRule.id,
        matchStrategy: activeDiningRule.matchStrategy,
        matchValue: activeDiningRule.matchValue,
        categoryId: activeDiningRule.categoryId,
        enabled: activeDiningRule.enabled,
      },
    ],
  });
  const suggestPlan = plannedOverride({
    transactionId: "txn-2",
    category: dining,
    action: "suggest",
  });
  const overrideOnlyPlan = plannedOverride({
    transactionId: "txn-3",
    action: "none",
  });

  const results = summarizeOverridePersistenceResults({
    planned: [createPlan, suggestPlan, overrideOnlyPlan],
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "category_rules unavailable",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "suggestions unavailable",
  });

  assert.deepEqual(
    results.map((result) => ({
      transactionId: result.transactionId,
      persisted: result.persisted,
      rulePersisted: result.rulePersisted,
      ruleError: result.ruleError,
      ruleSuggestionPersisted: result.ruleSuggestionPersisted,
      ruleSuggestionError: result.ruleSuggestionError,
    })),
    [
      {
        transactionId: "txn-1",
        persisted: true,
        rulePersisted: false,
        ruleError: "category_rules unavailable",
        ruleSuggestionPersisted: false,
        ruleSuggestionError: null,
      },
      {
        transactionId: "txn-2",
        persisted: true,
        rulePersisted: false,
        ruleError: null,
        ruleSuggestionPersisted: false,
        ruleSuggestionError: "suggestions unavailable",
      },
      {
        transactionId: "txn-3",
        persisted: true,
        rulePersisted: false,
        ruleError: null,
        ruleSuggestionPersisted: false,
        ruleSuggestionError: null,
      },
    ],
  );
});
