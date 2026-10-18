import assert from "node:assert/strict";
import test from "node:test";

import { planOverride } from "../../lib/categorization/override-plan.ts";
import {
  buildManualOverrideRows,
  buildOverridePersistenceResults,
  buildRulePersistenceRows,
  buildRuleSuggestionPersistenceRows,
} from "../../lib/categorization/override-persistence-rows.ts";

const NOW = "2026-09-02T10:00:00.000Z";
const USER_ID = "user-1";
const groceries = { id: "groceries", label: "Groceries" };

const existingDiningRule = {
  id: "rule-dining",
  name: "Wholefoods dining",
  description: "Old learned rule.",
  priority: 120,
  enabled: true,
  categoryId: "dining",
  categoryLabel: "Dining",
  matchStrategy: "merchant_contains",
  matchValue: "wholefoods",
  confidenceBoost: 0.77,
  hitRate: 0.42,
  lastMatchedAt: "2026-08-31T12:00:00.000Z",
};

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

function plannedOverride(action, overrides = {}) {
  const transaction = baseTransaction(overrides.transaction);
  return {
    transactionId: transaction.transactionId,
    plan: planOverride({
      userId: USER_ID,
      transaction,
      category: overrides.category ?? groceries,
      action,
      existingRules: overrides.existingRules ?? [],
      now: NOW,
      suggestionId: overrides.suggestionId ?? "suggestion-1",
      ruleId: overrides.ruleId ?? "rule-1",
    }),
  };
}

test("rule persistence rows tombstone a superseded rule before inserting the replacement", () => {
  const planned = plannedOverride("create", {
    existingRules: [
      {
        ruleId: existingDiningRule.id,
        matchStrategy: existingDiningRule.matchStrategy,
        matchValue: existingDiningRule.matchValue,
        categoryId: existingDiningRule.categoryId,
        enabled: existingDiningRule.enabled,
      },
    ],
    ruleId: "rule-groceries",
  });

  const overrideRows = buildManualOverrideRows([planned]);
  const ruleRows = buildRulePersistenceRows({
    userId: USER_ID,
    planned: [planned],
    existingRules: [existingDiningRule],
    now: NOW,
  });

  assert.deepEqual(overrideRows, [planned.plan.overrideRow]);
  assert.equal(ruleRows.length, 2);
  assert.deepEqual(ruleRows[0], {
    user_id: USER_ID,
    rule_id: "rule-dining",
    name: "Wholefoods dining",
    description: "Old learned rule.",
    priority: 120,
    enabled: false,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.77,
    hit_rate: 0.42,
    last_matched_at: "2026-08-31T12:00:00.000Z",
    created_at: NOW,
  });
  assert.equal(ruleRows[1].rule_id, "rule-groceries");
  assert.equal(ruleRows[1].enabled, true);
  assert.equal(ruleRows[1].category_id, "groceries");
});

test("suggestion persistence rows supersede stale pending suggestions and keep the new one", () => {
  const planned = plannedOverride("suggest", {
    suggestionId: "suggestion-keep",
  });

  const rows = buildRuleSuggestionPersistenceRows({
    userId: USER_ID,
    suggestionPlans: [planned],
    pendingSuggestions: [
      {
        suggestion_id: "suggestion-stale",
        transaction_id: "txn-1",
        priority: 100,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Old rule",
        rule_description: "Old suggestion.",
        source: "manual_override",
        note: "older",
        created_at: "2026-09-01T10:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-keep",
        transaction_id: "txn-1",
        priority: 110,
        category_id: "groceries",
        category_label: "Groceries",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Current rule",
        rule_description: "Current suggestion.",
        source: "manual_override",
        note: null,
        created_at: "2026-09-01T11:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-orphan",
        transaction_id: null,
        priority: 110,
        category_id: "fees",
        category_label: "Fees",
        match_strategy: "merchant_contains",
        match_value: "fee",
        rule_name: "No transaction",
        rule_description: "Should not be superseded.",
        source: "manual_override",
        note: null,
        created_at: "2026-09-01T12:00:00.000Z",
      },
    ],
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    user_id: USER_ID,
    suggestion_id: "suggestion-stale",
    transaction_id: "txn-1",
    priority: 100,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Old rule",
    rule_description: "Old suggestion.",
    source: "manual_override",
    status: "superseded",
    note: "older",
    created_at: "2026-09-01T10:00:00.000Z",
    updated_at: NOW,
    reviewed_at: NOW,
  });
  assert.equal(rows[1].suggestion_id, "suggestion-keep");
  assert.equal(rows[1].status, "pending");
});

test("persistence results attribute partial rule and suggestion failures per transaction", () => {
  const createPlan = plannedOverride("create", {
    existingRules: [
      {
        ruleId: existingDiningRule.id,
        matchStrategy: existingDiningRule.matchStrategy,
        matchValue: existingDiningRule.matchValue,
        categoryId: existingDiningRule.categoryId,
        enabled: existingDiningRule.enabled,
      },
    ],
    ruleId: "rule-groceries",
  });
  const suggestPlan = plannedOverride("suggest", {
    transaction: { transactionId: "txn-2" },
    suggestionId: "suggestion-2",
  });
  const noRulePlan = plannedOverride("suggest", {
    transaction: {
      transactionId: "txn-3",
      derivedCategoryId: "groceries",
    },
  });

  const results = buildOverridePersistenceResults({
    planned: [createPlan, suggestPlan, noRulePlan],
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "rule insert failed",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "suggestion insert failed",
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-1",
      persisted: true,
      rulePersisted: false,
      ruleError: "rule insert failed",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-2",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: "suggestion insert failed",
    },
    {
      transactionId: "txn-3",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});

test("unconfigured persistence results report local-only saves without errors", () => {
  const createPlan = plannedOverride("create", { ruleId: "rule-groceries" });

  const [result] = buildOverridePersistenceResults({
    planned: [createPlan],
    overridePersisted: false,
    ruleRowsPersisted: false,
    ruleError: null,
    suggestionRowsPersisted: false,
    ruleSuggestionError: null,
  });

  assert.deepEqual(result, {
    transactionId: "txn-1",
    persisted: false,
    rulePersisted: false,
    ruleError: null,
    ruleSuggestionPersisted: false,
    ruleSuggestionError: null,
  });
});
