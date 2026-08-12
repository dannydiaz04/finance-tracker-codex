import assert from "node:assert/strict";
import test from "node:test";

import { planOverride } from "../../lib/categorization/override-plan.ts";
import { buildOverrideIdentity } from "../../lib/categorization/override-identity.ts";
import {
  buildOverridePersistenceResults,
  buildRulePersistenceRows,
  buildSupersededSuggestionRows,
} from "../../lib/categorization/override-persistence-rows.ts";

const NOW = "2026-08-12T10:00:00.000Z";
const groceries = { id: "groceries", label: "Groceries" };

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

function rule(overrides = {}) {
  return {
    id: "rule-existing",
    name: "Wholefoods -> Dining",
    description: "Existing dining rule.",
    priority: 90,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.8,
    hitRate: 0.42,
    lastMatchedAt: null,
    ...overrides,
  };
}

function plannedOverride({
  transactionId = "txn-1",
  category = groceries,
  action = "suggest",
  existingRules = [],
  suggestionId = `suggestion-${transactionId}`,
  ruleId = `rule-${transactionId}`,
} = {}) {
  return {
    transactionId,
    plan: planOverride({
      userId: "user-1",
      transaction: transaction({ transactionId }),
      category,
      action,
      existingRules: existingRules.map((existing) => ({
        ruleId: existing.id,
        matchStrategy: existing.matchStrategy,
        matchValue: existing.matchValue,
        categoryId: existing.categoryId,
        enabled: existing.enabled,
      })),
      now: NOW,
      suggestionId,
      ruleId,
    }),
  };
}

function pendingSuggestion(overrides = {}) {
  return {
    suggestion_id: "stale-suggestion",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Dining",
    rule_description: "Older pending suggestion.",
    source: "manual_override",
    note: "old note",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("buildOverrideIdentity: retries reuse stable short hex ids", () => {
  const identity = buildOverrideIdentity({
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  });

  assert.match(identity, /^[a-f0-9]{24}$/);
  assert.equal(
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-1",
      categoryId: "groceries",
    }),
    identity,
  );
  assert.notEqual(
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-1",
      categoryId: "dining",
    }),
    identity,
  );
});

test("rule persistence rows tombstone a superseded rule before the replacement rule", () => {
  const existingRule = rule();
  const planned = [
    plannedOverride({
      category: groceries,
      action: "create",
      existingRules: [existingRule],
      ruleId: "learned-corrected",
    }),
  ];

  const rows = buildRulePersistenceRows({
    userId: "user-1",
    planned,
    existingRules: [existingRule],
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    {
      rule_id: rows[0].rule_id,
      enabled: rows[0].enabled,
      category_id: rows[0].category_id,
      created_at: rows[0].created_at,
      last_matched_at: rows[0].last_matched_at,
    },
    {
      rule_id: "rule-existing",
      enabled: false,
      category_id: "dining",
      created_at: NOW,
      last_matched_at: null,
    },
  );
  assert.deepEqual(
    {
      rule_id: rows[1].rule_id,
      enabled: rows[1].enabled,
      category_id: rows[1].category_id,
      match_value: rows[1].match_value,
    },
    {
      rule_id: "learned-corrected",
      enabled: true,
      category_id: "groceries",
      match_value: "wholefoods",
    },
  );
});

test("superseded suggestion rows preserve the kept retry identity and close only stale pending suggestions", () => {
  const planned = [
    plannedOverride({
      transactionId: "txn-1",
      action: "suggest",
      suggestionId: "kept-suggestion",
    }),
  ];

  const rows = buildSupersededSuggestionRows({
    userId: "user-1",
    planned,
    now: NOW,
    pending: [
      pendingSuggestion({ suggestion_id: "stale-suggestion" }),
      pendingSuggestion({ suggestion_id: "kept-suggestion" }),
      pendingSuggestion({ suggestion_id: "orphan-suggestion", transaction_id: null }),
    ],
  });

  assert.deepEqual(rows, [
    {
      user_id: "user-1",
      suggestion_id: "stale-suggestion",
      transaction_id: "txn-1",
      priority: 110,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "wholefoods",
      rule_name: "Wholefoods -> Dining",
      rule_description: "Older pending suggestion.",
      source: "manual_override",
      status: "superseded",
      note: "old note",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: NOW,
      reviewed_at: NOW,
    },
  ]);
});

test("persistence results report partial rule/suggestion failures only on items that wrote them", () => {
  const planned = [
    plannedOverride({ transactionId: "txn-noop", action: "none" }),
    plannedOverride({ transactionId: "txn-suggest", action: "suggest" }),
    plannedOverride({
      transactionId: "txn-create",
      category: groceries,
      action: "create",
      existingRules: [rule()],
    }),
  ];

  const results = buildOverridePersistenceResults({
    planned,
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "rule insert failed",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "suggestion insert failed",
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-noop",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-suggest",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: "suggestion insert failed",
    },
    {
      transactionId: "txn-create",
      persisted: true,
      rulePersisted: false,
      ruleError: "rule insert failed",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});
