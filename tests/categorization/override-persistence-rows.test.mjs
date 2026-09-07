import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOverridePersistenceResults,
  buildOverrideRuleRows,
  buildSupersededSuggestionRows,
} from "../../lib/categorization/override-persistence-rows.ts";
import { planOverride } from "../../lib/categorization/override-plan.ts";

const NOW = "2026-08-06T12:00:00.000Z";
const groceries = { id: "groceries", label: "Groceries" };
const dining = { id: "dining", label: "Dining" };

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

function existingRule(overrides = {}) {
  return {
    id: "rule-existing",
    name: "Wholefoods -> Dining",
    description: "Old learned rule.",
    priority: 110,
    enabled: true,
    categoryId: "dining",
    categoryLabel: "Dining",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods",
    confidenceBoost: 0.95,
    hitRate: 0.4,
    lastMatchedAt: "2026-08-01",
    ...overrides,
  };
}

function plan(input) {
  const planned = planOverride({
    userId: "user-1",
    transaction: baseTransaction(input.transaction ?? {}),
    category: input.category ?? groceries,
    action: input.action,
    existingRules: input.existingRules ?? [],
    now: NOW,
    suggestionId: input.suggestionId ?? "suggestion-1",
    ruleId: input.ruleId ?? "rule-1",
  });

  return {
    transactionId: planned.overrideRow.transaction_id,
    plan: planned,
  };
}

test("rule rows disable the replaced rule before appending the corrected learned rule", () => {
  const warehouseRule = existingRule();
  const planned = [
    plan({
      action: "create",
      category: groceries,
      existingRules: [
        {
          ruleId: warehouseRule.id,
          matchStrategy: warehouseRule.matchStrategy,
          matchValue: warehouseRule.matchValue,
          categoryId: warehouseRule.categoryId,
          enabled: true,
        },
      ],
      ruleId: "learned-new",
    }),
  ];

  const rows = buildOverrideRuleRows({
    userId: "user-1",
    planned,
    existingRules: [warehouseRule],
    now: NOW,
  });

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((row) => [row.rule_id, row.enabled, row.category_id]),
    [
      ["rule-existing", false, "dining"],
      ["learned-new", true, "groceries"],
    ],
  );
  assert.equal(rows[0].last_matched_at, "2026-08-01");
  assert.equal(rows[0].created_at, NOW);
  assert.equal(rows[1].match_value, "wholefoods");
});

test("stale pending suggestions are superseded while the current retry id is kept", () => {
  const rows = buildSupersededSuggestionRows({
    userId: "user-1",
    keepByTransaction: new Map([["txn-1", "suggestion-current"]]),
    now: NOW,
    pending: [
      {
        suggestion_id: "suggestion-old",
        transaction_id: "txn-1",
        priority: 110,
        category_id: "dining",
        category_label: "Dining",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Wholefoods -> Dining",
        rule_description: "Old suggestion.",
        source: "manual_override",
        note: "stale",
        created_at: "2026-08-01T12:00:00.000Z",
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
        rule_description: "Current suggestion.",
        source: "manual_override",
        note: null,
        created_at: NOW,
      },
      {
        suggestion_id: "suggestion-detached",
        transaction_id: null,
        priority: 110,
        category_id: "groceries",
        category_label: "Groceries",
        match_strategy: "merchant_contains",
        match_value: "wholefoods",
        rule_name: "Detached",
        rule_description: "No transaction id.",
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
      priority: 110,
      category_id: "dining",
      category_label: "Dining",
      match_strategy: "merchant_contains",
      match_value: "wholefoods",
      rule_name: "Wholefoods -> Dining",
      rule_description: "Old suggestion.",
      source: "manual_override",
      status: "superseded",
      note: "stale",
      created_at: "2026-08-01T12:00:00.000Z",
      updated_at: NOW,
      reviewed_at: NOW,
    },
  ]);
});

test("persistence results attach partial write errors only to plans that needed those writes", () => {
  const noRuleWrite = plan({
    action: "none",
    transaction: { transactionId: "txn-manual" },
  });
  const suggestionWrite = plan({
    action: "suggest",
    transaction: { transactionId: "txn-suggest" },
    suggestionId: "suggestion-txn-suggest",
  });
  const ruleWrite = plan({
    action: "create",
    transaction: { transactionId: "txn-create" },
    ruleId: "rule-txn-create",
  });

  const results = buildOverridePersistenceResults({
    planned: [noRuleWrite, suggestionWrite, ruleWrite],
    overridePersisted: true,
    ruleRowsPersisted: false,
    ruleError: "category_rules insert failed",
    suggestionRowsPersisted: false,
    ruleSuggestionError: "category_rule_suggestions insert failed",
  });

  assert.deepEqual(results, [
    {
      transactionId: "txn-manual",
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
      ruleSuggestionError: "category_rule_suggestions insert failed",
    },
    {
      transactionId: "txn-create",
      persisted: true,
      rulePersisted: false,
      ruleError: "category_rules insert failed",
      ruleSuggestionPersisted: false,
      ruleSuggestionError: null,
    },
  ]);
});

test("rule row building skips missing superseded rules but still writes the corrected rule", () => {
  const planned = [
    {
      ...plan({
        action: "create",
        category: groceries,
        existingRules: [
          {
            ruleId: "rule-missing",
            matchStrategy: "merchant_contains",
            matchValue: "wholefoods",
            categoryId: dining.id,
            enabled: true,
          },
        ],
        ruleId: "learned-new",
      }),
    },
  ];

  const rows = buildOverrideRuleRows({
    userId: "user-1",
    planned,
    existingRules: [],
    now: NOW,
  });

  assert.deepEqual(
    rows.map((row) => [row.rule_id, row.enabled, row.category_id]),
    [["learned-new", true, "groceries"]],
  );
});
