import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverridePersistenceResults,
  buildRulePersistenceRows,
  buildRuleSuggestionPersistenceRows,
} from "../../lib/categorization/override-persistence-plan.ts";

const NOW = "2026-07-27T20:00:00.000Z";

const overrideRow = (transactionId) => ({
  user_id: "user-1",
  transaction_id: transactionId,
  category_id: "groceries",
  reason: "Saved from review queue.",
  updated_at: NOW,
});

const ruleRow = (ruleId = "rule-new") => ({
  user_id: "user-1",
  rule_id: ruleId,
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
});

const suggestionRow = (suggestionId = "suggestion-new") => ({
  user_id: "user-1",
  suggestion_id: suggestionId,
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
});

function planned(transactionId, planOverrides = {}) {
  return {
    transactionId,
    plan: {
      overrideRow: overrideRow(transactionId),
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

test("rule persistence rows disable conflicting rules before writing replacements", () => {
  const rows = buildRulePersistenceRows({
    userId: "user-1",
    now: NOW,
    existingRules: [
      {
        id: "rule-old",
        name: "Wholefoods -> Dining",
        description: "Old classification.",
        priority: 90,
        enabled: true,
        categoryId: "dining",
        categoryLabel: "Dining",
        matchStrategy: "merchant_contains",
        matchValue: "wholefoods",
        confidenceBoost: 0.7,
        hitRate: 0.42,
        lastMatchedAt: "2026-07-20T12:00:00.000Z",
      },
    ],
    planned: [
      planned("txn-1", {
        ruleAction: "create",
        ruleRow: ruleRow(),
        supersedeRuleId: "rule-old",
        dedupe: "conflict",
        conflictCategoryId: "dining",
      }),
    ],
  });

  assert.deepEqual(rows, [
    {
      user_id: "user-1",
      rule_id: "rule-old",
      name: "Wholefoods -> Dining",
      description: "Old classification.",
      priority: 90,
      enabled: false,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "wholefoods",
      confidence_boost: 0.7,
      hit_rate: 0.42,
      last_matched_at: "2026-07-20T12:00:00.000Z",
      created_at: NOW,
    },
    ruleRow(),
  ]);
});

test("rule suggestion rows supersede stale pending suggestions and keep the reviewed suggestion", () => {
  const rows = buildRuleSuggestionPersistenceRows({
    userId: "user-1",
    now: NOW,
    planned: [
      planned("txn-1", {
        ruleAction: "suggest",
        ruleSuggestion: suggestionRow("suggestion-new"),
      }),
    ],
    pending: [
      {
        suggestion_id: "suggestion-stale",
        transaction_id: "txn-1",
        priority: 95,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Dining",
        rule_description: "Old pending classification.",
        source: "manual_override",
        note: "replace me",
        created_at: "2026-07-20T12:00:00.000Z",
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
        rule_description: "Already the reviewed suggestion.",
        source: "manual_override",
        note: null,
        created_at: "2026-07-21T12:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-without-transaction",
        transaction_id: null,
        priority: 110,
        category_id: "groceries",
        category_label: "Groceries",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "No transaction",
        rule_description: "Should not be superseded.",
        source: "manual_override",
        note: null,
        created_at: "2026-07-21T12:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-other-transaction",
        transaction_id: "txn-unrelated",
        priority: 110,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Unrelated transaction",
        rule_description: "Should not be superseded by this batch.",
        source: "manual_override",
        note: null,
        created_at: "2026-07-21T12:00:00.000Z",
      },
    ],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    user_id: "user-1",
    suggestion_id: "suggestion-stale",
    transaction_id: "txn-1",
    priority: 95,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Dining",
    rule_description: "Old pending classification.",
    source: "manual_override",
    status: "superseded",
    note: "replace me",
    created_at: "2026-07-20T12:00:00.000Z",
    updated_at: NOW,
    reviewed_at: NOW,
  });
  assert.deepEqual(rows[1], suggestionRow("suggestion-new"));
});

test("persistence results report rule and suggestion partial failures per affected transaction", () => {
  const results = buildOverridePersistenceResults({
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "rule table unavailable",
    suggestionRowsPersisted: true,
    ruleSuggestionError: null,
    planned: [
      planned("txn-rule", {
        ruleAction: "create",
        ruleRow: ruleRow("rule-new"),
      }),
      planned("txn-override-only"),
      planned("txn-suggestion", {
        ruleAction: "suggest",
        ruleSuggestion: suggestionRow("suggestion-new"),
      }),
    ],
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-rule",
      persisted: true,
      rulePersisted: false,
      ruleError: "rule table unavailable",
      ruleSuggestionPersisted: false,
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
    {
      transactionId: "txn-suggestion",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: true,
      ruleSuggestionError: null,
    },
  ]);
});
