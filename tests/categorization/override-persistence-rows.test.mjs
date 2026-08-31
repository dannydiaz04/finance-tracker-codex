import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverridePersistenceResults,
  buildOverrideRuleRows,
  buildRuleSuggestionRows,
} from "../../lib/categorization/override-persistence-rows.ts";

const now = "2026-06-22T00:00:00.000Z";

function planned(transactionId, planOverrides = {}) {
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
      ...planOverrides,
    },
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

test("override persistence rule rows disable a conflicting rule before inserting its replacement", () => {
  const replacementRule = {
    user_id: "user-1",
    rule_id: "rule-new",
    name: "Wholefoods -> Groceries",
    description: "Learned from manual categorization of Wholefoods.",
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
  };

  const rows = buildOverrideRuleRows({
    userId: "user-1",
    now,
    planned: [
      planned("txn-1", {
        ruleAction: "create",
        ruleRow: replacementRule,
        supersedeRuleId: "rule-old",
        dedupe: "conflict",
      }),
    ],
    existingRules: [
      {
        id: "rule-old",
        name: "Wholefoods -> Dining",
        description: "Existing user rule.",
        priority: 90,
        enabled: true,
        categoryId: "dining",
        categoryLabel: "Dining",
        matchStrategy: "merchant_contains",
        matchValue: "wholefoods",
        confidenceBoost: 0.8,
        hitRate: 0.42,
        lastMatchedAt: "2026-06-01",
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      user_id: "user-1",
      rule_id: "rule-old",
      name: "Wholefoods -> Dining",
      description: "Existing user rule.",
      priority: 90,
      enabled: false,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "wholefoods",
      confidence_boost: 0.8,
      hit_rate: 0.42,
      last_matched_at: "2026-06-01",
      created_at: now,
    },
    replacementRule,
  ]);
});

test("override persistence suggestion rows supersede stale pending suggestions without duplicating the retry id", () => {
  const freshSuggestion = suggestionRow();

  const rows = buildRuleSuggestionRows({
    userId: "user-1",
    now,
    planned: [
      planned("txn-1", {
        ruleAction: "suggest",
        ruleSuggestion: freshSuggestion,
      }),
    ],
    pending: [
      {
        suggestion_id: "suggestion-old",
        transaction_id: "txn-1",
        priority: 80,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Dining",
        rule_description: "Old pending suggestion.",
        source: "manual_override",
        note: "previous review",
        created_at: "2026-06-01T00:00:00.000Z",
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
        rule_description: "Retry of the same suggestion.",
        source: "manual_override",
        note: null,
        created_at: "2026-06-01T00:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-detached",
        transaction_id: null,
        priority: 70,
        category_id: "shopping",
        category_label: "Shopping",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Detached suggestion",
        rule_description: "No transaction to supersede.",
        source: "manual_override",
        note: null,
        created_at: "2026-06-01T00:00:00.000Z",
      },
    ],
  });

  assert.deepEqual(rows.map((row) => row.suggestion_id), [
    "suggestion-old",
    "suggestion-new",
  ]);
  assert.deepEqual(rows[0], {
    user_id: "user-1",
    suggestion_id: "suggestion-old",
    transaction_id: "txn-1",
    priority: 80,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Dining",
    rule_description: "Old pending suggestion.",
    source: "manual_override",
    status: "superseded",
    note: "previous review",
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: now,
    reviewed_at: now,
  });
  assert.equal(rows[1], freshSuggestion);
});

test("override persistence results attribute partial failures only to plans with matching writes", () => {
  const results = buildOverridePersistenceResults({
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "rule insert failed",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "suggestion insert failed",
    planned: [
      planned("txn-rule", {
        ruleAction: "create",
        ruleRow: { rule_id: "rule-new" },
      }),
      planned("txn-suggestion", {
        ruleAction: "suggest",
        ruleSuggestion: suggestionRow({ transaction_id: "txn-suggestion" }),
      }),
      planned("txn-override-only"),
    ],
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
