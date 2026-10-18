import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCategoryRuleRows,
  buildOverridePersistenceResults,
  buildStaleSuggestionRows,
} from "../../lib/categorization/override-persistence-rows.ts";

const NOW = "2026-08-08T10:00:00.000Z";

function existingRule(overrides = {}) {
  return {
    id: "rule-old",
    name: "Wholefoods -> Dining",
    description: "Old learned rule.",
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

function ruleRow(overrides = {}) {
  return {
    user_id: "user-1",
    rule_id: "rule-new",
    name: "Wholefoods -> Groceries",
    description: "Learned from manual categorization.",
    priority: 110,
    enabled: true,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.95,
    hit_rate: 0,
    last_matched_at: null,
    created_at: NOW,
    ...overrides,
  };
}

function suggestionRow(overrides = {}) {
  return {
    user_id: "user-1",
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
    status: "pending",
    note: null,
    created_at: NOW,
    updated_at: NOW,
    reviewed_at: null,
    ...overrides,
  };
}

function plannedOverride({ transactionId = "txn-1", plan = {} } = {}) {
  return {
    transactionId,
    plan: {
      overrideRow: {
        user_id: "user-1",
        transaction_id: transactionId,
        category_id: "groceries",
        reason: "Saved from review queue.",
        updated_at: NOW,
      },
      ruleRow: null,
      supersedeRuleId: null,
      ruleSuggestion: null,
      ...plan,
    },
  };
}

test("buildCategoryRuleRows disables the conflicting rule before inserting the replacement", () => {
  const replacement = ruleRow();
  const rows = buildCategoryRuleRows({
    userId: "user-1",
    existingRules: [existingRule()],
    now: NOW,
    planned: [
      plannedOverride({
        plan: {
          supersedeRuleId: "rule-old",
          ruleRow: replacement,
        },
      }),
    ],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    user_id: "user-1",
    rule_id: "rule-old",
    name: "Wholefoods -> Dining",
    description: "Old learned rule.",
    priority: 110,
    enabled: false,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.95,
    hit_rate: 0.5,
    last_matched_at: "2026-08-01T00:00:00.000Z",
    created_at: NOW,
  });
  assert.equal(rows[1], replacement);
});

test("buildStaleSuggestionRows supersedes older pending suggestions for the same transaction only", () => {
  const rows = buildStaleSuggestionRows({
    userId: "user-1",
    now: NOW,
    planned: [
      plannedOverride({
        transactionId: "txn-1",
        plan: { ruleSuggestion: suggestionRow({ suggestion_id: "suggestion-new" }) },
      }),
    ],
    pending: [
      {
        suggestion_id: "suggestion-old",
        transaction_id: "txn-1",
        priority: 100,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Dining",
        rule_description: "Old suggestion.",
        source: "manual_override",
        note: "stale",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-new",
        transaction_id: "txn-1",
        priority: 110,
        category_id: "groceries",
        category_label: "Groceries",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Groceries",
        rule_description: "Current suggestion.",
        source: "manual_override",
        note: null,
        created_at: NOW,
      },
      {
        suggestion_id: "suggestion-other",
        transaction_id: "txn-2",
        priority: 110,
        category_id: "travel",
        category_label: "Travel",
        match_strategy: "merchant_contains",
        match_value: "airline",
        rule_name: "Airline -> Travel",
        rule_description: "Unrelated suggestion.",
        source: "manual_override",
        note: null,
        created_at: NOW,
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      user_id: "user-1",
      suggestion_id: "suggestion-old",
      transaction_id: "txn-1",
      priority: 100,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "wholefoods",
      rule_name: "Wholefoods -> Dining",
      rule_description: "Old suggestion.",
      source: "manual_override",
      status: "superseded",
      note: "stale",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: NOW,
      reviewed_at: NOW,
    },
  ]);
});

test("buildOverridePersistenceResults scopes partial write flags to affected transactions", () => {
  const results = buildOverridePersistenceResults({
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "category_rules unavailable",
    suggestionRowsPersisted: true,
    ruleSuggestionError: null,
    planned: [
      plannedOverride({
        transactionId: "txn-rule",
        plan: { ruleRow: ruleRow({ rule_id: "rule-txn-rule" }) },
      }),
      plannedOverride({
        transactionId: "txn-suggestion",
        plan: { ruleSuggestion: suggestionRow({ transaction_id: "txn-suggestion" }) },
      }),
      plannedOverride({ transactionId: "txn-override-only" }),
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
