import assert from "node:assert/strict";
import test from "node:test";

import { buildOverrideIdentity } from "../../lib/categorization/override-identity.ts";
import {
  buildOverridePersistenceResults,
  buildOverrideRuleRows,
  buildSupersededSuggestionRows,
} from "../../lib/categorization/override-persistence-plan.ts";

const NOW = "2026-08-07T10:00:00.000Z";

function planned(transactionId, plan = {}) {
  return {
    transactionId,
    plan: {
      ruleRow: null,
      ruleSuggestion: null,
      supersedeRuleId: null,
      ...plan,
    },
  };
}

function existingRule(overrides = {}) {
  return {
    id: "rule-dining",
    name: "Wholefoods -> Dining",
    description: "Previously learned from a bad correction.",
    priority: 90,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.7,
    hitRate: 0.25,
    lastMatchedAt: null,
    ...overrides,
  };
}

test("buildOverrideIdentity: stable retry ids are fixed-width and input-sensitive", () => {
  const identity = buildOverrideIdentity({
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  });

  assert.equal(identity, "ab129f1dd46e93a1ffe09c0f");
  assert.match(identity, /^[0-9a-f]{24}$/);
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
      transactionId: "txn-2",
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
  assert.notEqual(
    buildOverrideIdentity({
      userId: "user-2",
      transactionId: "txn-1",
      categoryId: "groceries",
    }),
    identity,
  );
});

test("buildOverrideRuleRows: disables superseded conflicts before writing the learned rule", () => {
  const learnedRule = {
    user_id: "user-1",
    rule_id: "learned-groceries",
    name: "Wholefoods -> Groceries",
    enabled: true,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "wholefoods",
    created_at: NOW,
  };

  const rows = buildOverrideRuleRows({
    userId: "user-1",
    now: NOW,
    existingRules: [existingRule()],
    planned: [
      planned("txn-1", {
        supersedeRuleId: "rule-dining",
        ruleRow: learnedRule,
      }),
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].rule_id, "rule-dining");
  assert.equal(rows[0].enabled, false);
  assert.equal(rows[0].user_id, "user-1");
  assert.equal(rows[0].category_id, "dining");
  assert.equal(rows[0].created_at, NOW);
  assert.equal(rows[1], learnedRule);
});

test("buildSupersededSuggestionRows: tombstones only stale pending suggestions", () => {
  const rows = buildSupersededSuggestionRows({
    userId: "user-1",
    now: NOW,
    keepByTransaction: new Map([["txn-1", "suggestion-current"]]),
    pending: [
      {
        suggestion_id: "suggestion-stale",
        transaction_id: "txn-1",
        priority: 110,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Dining",
        rule_description: "Stale pending suggestion.",
        source: "manual_override",
        note: "old note",
        created_at: "2026-08-06T10:00:00.000Z",
      },
      {
        suggestion_id: "suggestion-current",
        transaction_id: "txn-1",
        priority: 110,
        category_id: "groceries",
        category_label: "Groceries",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Groceries",
        rule_description: "Current batch suggestion.",
        source: "manual_override",
        note: null,
        created_at: NOW,
      },
      {
        suggestion_id: "suggestion-missing-transaction",
        transaction_id: null,
        priority: 110,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "No transaction",
        rule_description: "Should not be tombstoned.",
        source: "manual_override",
        note: null,
        created_at: NOW,
      },
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
      match_value: "wholefoods",
      rule_name: "Wholefoods -> Dining",
      rule_description: "Stale pending suggestion.",
      source: "manual_override",
      status: "superseded",
      note: "old note",
      created_at: "2026-08-06T10:00:00.000Z",
      updated_at: NOW,
      reviewed_at: NOW,
    },
  ]);
});

test("buildOverridePersistenceResults: scopes partial failures to affected row types", () => {
  const results = buildOverridePersistenceResults({
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "category_rules insert failed",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "category_rule_suggestions insert failed",
    planned: [
      planned("txn-create", {
        ruleRow: { rule_id: "learned-groceries" },
      }),
      planned("txn-suggest", {
        ruleSuggestion: { suggestion_id: "suggestion-groceries" },
      }),
      planned("txn-override-only"),
    ],
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-create",
      persisted: true,
      rulePersisted: false,
      ruleError: "category_rules insert failed",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
    {
      transactionId: "txn-suggest",
      persisted: true,
      rulePersisted: false,
      ruleError: null,
      ruleSuggestionPersisted: false,
      ruleSuggestionError: "category_rule_suggestions insert failed",
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
