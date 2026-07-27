import assert from "node:assert/strict";
import test from "node:test";

import {
  RuleRevisionConflictError,
  planRuleRevision,
} from "../../lib/categorization/rule-revision.ts";

const existingRule = {
  id: "rule-1",
  name: "Coffee shops",
  description: "Categorize coffee purchases.",
  priority: 110,
  enabled: true,
  categoryId: "coffee",
  categoryLabel: "Coffee",
  matchStrategy: "merchant_contains",
  matchValue: "coffee shop",
  confidenceBoost: 0.95,
  hitRate: 0.42,
  lastMatchedAt: "2026-07-20T12:00:00.000Z",
};

function plan(overrides = {}) {
  return planRuleRevision({
    userId: "user-1",
    existingRule,
    otherRules: [],
    category: { id: "dining", label: "Dining" },
    draft: {
      name: "Coffee and cafés",
      description: "Categorize café purchases.",
      priority: 120,
      categoryId: "dining",
      matchStrategy: "merchant_contains",
      matchValue: "coffee shop",
    },
    now: "2026-07-27T21:00:00.000Z",
    ...overrides,
  });
}

test("rule revisions preserve identity and accumulated metrics", () => {
  const result = plan();

  assert.equal(result.status, "updated");
  assert.equal(result.row.rule_id, existingRule.id);
  assert.equal(result.row.category_id, "dining");
  assert.equal(result.row.confidence_boost, existingRule.confidenceBoost);
  assert.equal(result.row.hit_rate, existingRule.hitRate);
  assert.equal(result.row.last_matched_at, existingRule.lastMatchedAt);
  assert.equal(result.rule.categoryLabel, "Dining");
});

test("unchanged edits do not append another rule version", () => {
  const result = plan({
    category: { id: "coffee", label: "Coffee" },
    draft: {
      name: existingRule.name,
      description: existingRule.description,
      priority: existingRule.priority,
      categoryId: existingRule.categoryId,
      matchStrategy: existingRule.matchStrategy,
      matchValue: existingRule.matchValue,
    },
  });

  assert.equal(result.status, "unchanged");
  assert.equal(result.row, null);
});

test("rule revisions apply match guardrails", () => {
  const result = plan({
    draft: {
      name: existingRule.name,
      description: existingRule.description,
      priority: existingRule.priority,
      categoryId: "dining",
      matchStrategy: "merchant_contains",
      matchValue: "Amazon",
    },
  });

  assert.equal(result.rule.matchStrategy, "merchant_exact");
  assert.equal(result.rule.matchValue, "amazon");
  assert.match(result.guardrailNote, /broad payment aggregator/);
});

test("rule revisions reject a match already owned by another active rule", () => {
  assert.throws(
    () =>
      plan({
        otherRules: [
          {
            ...existingRule,
            id: "rule-2",
            categoryId: "travel",
            categoryLabel: "Travel",
            matchValue: "coffee shop",
          },
        ],
      }),
    RuleRevisionConflictError,
  );
});
