import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRuleRows,
  buildRuleSuggestionRows,
} from "../../lib/categorization/override-persistence-rows.ts";

const NOW = "2026-08-09T10:00:00.000Z";

function plannedOverride({
  transactionId = "txn-1",
  ruleRow = null,
  ruleSuggestion = null,
  supersedeRuleId = null,
} = {}) {
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
      ruleRow,
      ruleSuggestion,
      supersedeRuleId,
    },
  };
}

function activeRule(overrides = {}) {
  return {
    id: "rule-old",
    name: "Old Cafe rule",
    description: "Categorize cafe transactions.",
    priority: 90,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "cafe",
    confidenceBoost: 0.8,
    hitRate: 0.42,
    lastMatchedAt: null,
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
    match_value: "cafe",
    rule_name: "Cafe",
    rule_description: "Categorize cafe transactions.",
    source: "manual_override",
    note: "old suggestion",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

test("buildRuleRows writes a disabled tombstone before the replacement rule", () => {
  const replacementRule = {
    user_id: "user-1",
    rule_id: "rule-new",
    name: "New Cafe rule",
    description: "Categorize cafe transactions as groceries.",
    priority: 110,
    enabled: true,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "cafe",
    confidence_boost: 0.95,
    hit_rate: 0,
    last_matched_at: null,
    created_at: NOW,
  };

  const rows = buildRuleRows({
    userId: "user-1",
    existingRules: [activeRule()],
    now: NOW,
    planned: [
      plannedOverride({
        supersedeRuleId: "rule-old",
        ruleRow: replacementRule,
      }),
    ],
  });

  assert.deepEqual(rows, [
    {
      user_id: "user-1",
      rule_id: "rule-old",
      name: "Old Cafe rule",
      description: "Categorize cafe transactions.",
      priority: 90,
      enabled: false,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "cafe",
      confidence_boost: 0.8,
      hit_rate: 0.42,
      last_matched_at: null,
      created_at: NOW,
    },
    replacementRule,
  ]);
});

test("buildRuleSuggestionRows supersedes only stale pending suggestions for the batch transaction", () => {
  const currentSuggestion = {
    user_id: "user-1",
    suggestion_id: "suggestion-current",
    transaction_id: "txn-1",
    priority: 110,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "cafe",
    rule_name: "Cafe",
    rule_description: "Categorize cafe transactions as groceries.",
    source: "manual_override",
    status: "pending",
    note: "new suggestion",
    created_at: NOW,
    updated_at: NOW,
    reviewed_at: null,
  };

  const rows = buildRuleSuggestionRows({
    userId: "user-1",
    now: NOW,
    planned: [
      plannedOverride({
        transactionId: "txn-1",
        ruleSuggestion: currentSuggestion,
      }),
    ],
    pendingSuggestions: [
      pendingSuggestion(),
      pendingSuggestion({ suggestion_id: "suggestion-current" }),
      pendingSuggestion({
        suggestion_id: "suggestion-other-transaction",
        transaction_id: "txn-2",
      }),
      pendingSuggestion({
        suggestion_id: "suggestion-without-transaction",
        transaction_id: null,
      }),
    ],
  });

  assert.deepEqual(rows, [
    {
      user_id: "user-1",
      suggestion_id: "suggestion-stale",
      transaction_id: "txn-1",
      priority: 110,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "cafe",
      rule_name: "Cafe",
      rule_description: "Categorize cafe transactions.",
      source: "manual_override",
      status: "superseded",
      note: "old suggestion",
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: NOW,
      reviewed_at: NOW,
    },
    currentSuggestion,
  ]);
});
