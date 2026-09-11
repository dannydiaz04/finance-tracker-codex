import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverridePersistenceResults,
  buildRuleRowsForPlans,
  buildStaleSuggestionRows,
} from "../../lib/categorization/override-persistence-rows.ts";

const now = "2026-08-01T12:00:00.000Z";

const existingRule = {
  id: "rule-old",
  name: "Wholefoods -> Dining",
  description: "Existing learned rule.",
  priority: 110,
  enabled: true,
  categoryId: "dining",
  categoryLabel: "Dining",
  matchStrategy: "merchant_contains",
  matchValue: "wholefoods",
  confidenceBoost: 0.95,
  hitRate: 0.42,
  lastMatchedAt: null,
};

function plannedOverride(transactionId, planOverrides = {}) {
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

function ruleRow(ruleId, categoryId = "groceries") {
  return {
    user_id: "user-1",
    rule_id: ruleId,
    name: "Wholefoods -> Groceries",
    description: "Learned from manual categorization of Wholefoods.",
    priority: 110,
    enabled: true,
    category_id: categoryId,
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    confidence_boost: 0.95,
    hit_rate: 0,
    last_matched_at: null,
    created_at: now,
  };
}

function suggestionRow(suggestionId, transactionId) {
  return {
    user_id: "user-1",
    suggestion_id: suggestionId,
    transaction_id: transactionId,
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
  };
}

function pendingSuggestion(suggestionId, transactionId) {
  return {
    suggestion_id: suggestionId,
    transaction_id: transactionId,
    priority: 110,
    category_id: "dining",
    category_label: "Dining",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    rule_name: "Wholefoods -> Dining",
    rule_description: "Existing pending suggestion.",
    source: "ai_suggestion",
    note: "needs review",
    created_at: "2026-07-31T12:00:00.000Z",
  };
}

test("rule row planning disables the conflicting active rule before writing its replacement", () => {
  const replacement = ruleRow("rule-new");
  const rows = buildRuleRowsForPlans({
    userId: "user-1",
    existingRules: [existingRule],
    now,
    planned: [
      plannedOverride("txn-1", {
        ruleAction: "create",
        ruleRow: replacement,
        supersedeRuleId: existingRule.id,
        dedupe: "conflict",
      }),
    ],
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => row.rule_id),
    ["rule-old", "rule-new"],
  );
  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].category_id, "dining");
  assert.equal(rows[0].created_at, now);
  assert.deepEqual(rows[1], replacement);
});

test("stale pending suggestions are superseded while retry-stable suggestions are kept", () => {
  const rows = buildStaleSuggestionRows({
    userId: "user-1",
    now,
    planned: [
      plannedOverride("txn-1", {
        ruleAction: "suggest",
        ruleSuggestion: suggestionRow("suggestion-keep", "txn-1"),
      }),
    ],
    pending: [
      pendingSuggestion("suggestion-stale", "txn-1"),
      pendingSuggestion("suggestion-keep", "txn-1"),
      pendingSuggestion("suggestion-other-transaction", "txn-2"),
      pendingSuggestion("suggestion-without-transaction", null),
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].suggestion_id, "suggestion-stale");
  assert.equal(rows[0].transaction_id, "txn-1");
  assert.equal(rows[0].status, "superseded");
  assert.equal(rows[0].created_at, "2026-07-31T12:00:00.000Z");
  assert.equal(rows[0].updated_at, now);
  assert.equal(rows[0].reviewed_at, now);
});

test("persistence results attribute partial failures only to plans that wrote those rows", () => {
  const results = buildOverridePersistenceResults({
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "category_rules insert failed",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "category_rule_suggestions insert failed",
    planned: [
      plannedOverride("txn-no-rule"),
      plannedOverride("txn-rule", {
        ruleAction: "create",
        ruleRow: ruleRow("rule-new"),
      }),
      plannedOverride("txn-suggestion", {
        ruleAction: "suggest",
        ruleSuggestion: suggestionRow("suggestion-new", "txn-suggestion"),
      }),
    ],
  });

  assert.deepEqual(results[0], {
    transactionId: "txn-no-rule",
    persisted: true,
    rulePersisted: false,
    ruleError: null,
    ruleSuggestionPersisted: false,
    ruleSuggestionError: null,
  });
  assert.equal(results[1].rulePersisted, false);
  assert.equal(results[1].ruleError, "category_rules insert failed");
  assert.equal(results[1].ruleSuggestionError, null);
  assert.equal(results[2].ruleError, null);
  assert.equal(
    results[2].ruleSuggestionError,
    "category_rule_suggestions insert failed",
  );
});
