import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverridePersistenceResults,
  buildOverrideRuleRows,
  buildSupersededSuggestionRows,
} from "../../lib/categorization/override-persistence-rows.ts";

const NOW = "2026-08-01T12:00:00.000Z";

function plannedOverride(transactionId, planOverrides = {}) {
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

test("replacement rules emit the disabled tombstone before the new active rule", () => {
  const replacementRule = {
    user_id: "user-1",
    rule_id: "learned-rule",
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
    created_at: NOW,
  };

  const rows = buildOverrideRuleRows({
    userId: "user-1",
    planned: [
      plannedOverride("txn-1", {
        ruleAction: "create",
        ruleRow: replacementRule,
        supersedeRuleId: "old-rule",
      }),
    ],
    existingRules: [
      {
        id: "old-rule",
        name: "Wholefoods -> Dining",
        description: "Old rule",
        priority: 80,
        enabled: true,
        categoryId: "dining",
        categoryLabel: "Dining",
        matchStrategy: "merchant_contains",
        matchValue: "wholefoods",
        confidenceBoost: 0.7,
        hitRate: 12,
        lastMatchedAt: "2026-07-31T00:00:00.000Z",
      },
    ],
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    user_id: "user-1",
    rule_id: "old-rule",
    name: "Wholefoods -> Dining",
    description: "Old rule",
    priority: 80,
    enabled: false,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.7,
    hit_rate: 12,
    last_matched_at: "2026-07-31T00:00:00.000Z",
    created_at: NOW,
  });
  assert.equal(rows[1], replacementRule);
});

test("stale pending suggestions for the same transaction are superseded, but the retry id is kept", () => {
  const ruleSuggestion = {
    user_id: "user-1",
    suggestion_id: "rule-suggestion-keep",
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
    created_at: NOW,
    updated_at: NOW,
    reviewed_at: null,
  };

  const rows = buildSupersededSuggestionRows({
    userId: "user-1",
    planned: [
      plannedOverride("txn-1", {
        ruleAction: "suggest",
        ruleSuggestion,
      }),
    ],
    pending: [
      {
        suggestion_id: "rule-suggestion-stale",
        transaction_id: "txn-1",
        priority: 90,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Dining",
        rule_description: "Previous suggestion",
        source: "manual_override",
        note: "old note",
        created_at: "2026-07-01T00:00:00.000Z",
      },
      {
        suggestion_id: "rule-suggestion-keep",
        transaction_id: "txn-1",
        priority: 110,
        category_id: "groceries",
        category_label: "Groceries",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Groceries",
        rule_description: "Current retry",
        source: "manual_override",
        note: null,
        created_at: NOW,
      },
      {
        suggestion_id: "rule-suggestion-unscoped",
        transaction_id: null,
        priority: 50,
        category_id: "misc",
        category_label: "Misc",
        match_strategy: "merchant_contains",
        match_value: "unknown",
        rule_name: "Unknown -> Misc",
        rule_description: "No transaction to supersede",
        source: "manual_override",
        note: null,
        created_at: NOW,
      },
    ],
    now: NOW,
  });

  assert.deepEqual(rows, [
    {
      user_id: "user-1",
      suggestion_id: "rule-suggestion-stale",
      transaction_id: "txn-1",
      priority: 90,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "wholefoods",
      rule_name: "Wholefoods -> Dining",
      rule_description: "Previous suggestion",
      source: "manual_override",
      status: "superseded",
      note: "old note",
      created_at: "2026-07-01T00:00:00.000Z",
      updated_at: NOW,
      reviewed_at: NOW,
    },
  ]);
});

test("partial write failures are reported only on transactions that needed that side table", () => {
  const results = buildOverridePersistenceResults({
    planned: [
      plannedOverride("override-only"),
      plannedOverride("rule-write", {
        ruleAction: "create",
        ruleRow: { rule_id: "rule-1" },
      }),
      plannedOverride("suggestion-write", {
        ruleAction: "suggest",
        ruleSuggestion: { suggestion_id: "suggestion-1" },
      }),
    ],
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "rule table unavailable",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "suggestion table unavailable",
  });

  assert.deepEqual(results, [
    {
      transactionId: "override-only",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "rule-write",
      persisted: true,
      rulePersisted: false,
      ruleError: "rule table unavailable",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "suggestion-write",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: "suggestion table unavailable",
    },
  ]);
});
