import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCategoryDefinitionRow,
  buildReassignedCategoryRuleRow,
  isSystemCategoryId,
  mergeCategoryDefinitions,
  slugifyCategoryId,
} from "../../lib/categorization/category-catalog.ts";

const seed = [
  {
    id: "groceries",
    label: "Groceries",
    group: "Essential",
    sublabel: "Food at home",
    color: "#8f7cff",
  },
  {
    id: "salary",
    label: "Salary",
    group: "Income",
    sublabel: "Payroll",
    color: "#74ff9f",
  },
  {
    id: "travel",
    label: "Travel",
    group: "Lifestyle",
    sublabel: "Trips",
    color: "#ff7c9d",
  },
];

test("mergeCategoryDefinitions overlays user rows, archives removed categories, and sorts deterministically", () => {
  const merged = mergeCategoryDefinitions(seed, [
    {
      id: "travel",
      label: "Travel",
      group: "Lifestyle",
      sublabel: "Trips",
      color: "#ff7c9d",
      sortOrder: null,
      status: "archived",
      isSystem: false,
    },
    {
      id: "custom-childcare",
      label: "Childcare",
      group: "Family",
      sublabel: "Daycare",
      color: "#f97316",
      sortOrder: 1,
      status: "active",
      isSystem: false,
    },
    {
      id: "groceries",
      label: "Food",
      group: "Essential",
      sublabel: "Groceries and household staples",
      color: "",
      sortOrder: 2,
      status: "active",
      isSystem: false,
    },
  ]);

  assert.deepEqual(
    merged.map((category) => category.id),
    ["custom-childcare", "groceries", "salary"],
  );
  assert.deepEqual(merged[0], {
    id: "custom-childcare",
    label: "Childcare",
    group: "Family",
    sublabel: "Daycare",
    color: "#f97316",
    isSystem: false,
    sortOrder: 1,
  });
  assert.deepEqual(merged[1], {
    id: "groceries",
    label: "Food",
    group: "Essential",
    sublabel: "Groceries and household staples",
    color: "#64748b",
    isSystem: true,
    sortOrder: 2,
  });
});

test("mergeCategoryDefinitions treats protected category ids as system categories even for user rows", () => {
  const merged = mergeCategoryDefinitions([], [
    {
      id: "credit-card-payment",
      label: "Card Payments",
      group: "Internal",
      sublabel: "Accounting",
      color: "#38bdf8",
      sortOrder: null,
      status: "active",
      isSystem: false,
    },
  ]);

  assert.equal(isSystemCategoryId("credit-card-payment"), true);
  assert.equal(merged[0].isSystem, true);
});

test("slugifyCategoryId creates stable ids with sanitized labels and seed-specific suffixes", () => {
  const first = slugifyCategoryId("Cafe & Snacks!", "user-1|2026-06-23T00:00:00.000Z");
  const again = slugifyCategoryId("Cafe & Snacks!", "user-1|2026-06-23T00:00:00.000Z");
  const otherSeed = slugifyCategoryId("Cafe & Snacks!", "user-2|2026-06-23T00:00:00.000Z");
  const fallback = slugifyCategoryId("!!!", "user-1");

  assert.equal(first, again);
  assert.notEqual(first, otherSeed);
  assert.match(first, /^cafe-snacks-[a-z0-9]{1,6}$/);
  assert.match(fallback, /^category-[a-z0-9]{1,6}$/);
});

test("buildCategoryDefinitionRow writes append-only category definitions with nullable sort order", () => {
  const row = buildCategoryDefinitionRow({
    userId: "user-1",
    now: "2026-06-23T10:00:00.000Z",
    status: "archived",
    isSystem: false,
    category: {
      id: "custom-childcare",
      label: "Childcare",
      group: "Family",
      sublabel: "Daycare",
      color: "#f97316",
      sortOrder: null,
    },
  });

  assert.deepEqual(row, {
    user_id: "user-1",
    category_id: "custom-childcare",
    label: "Childcare",
    category_l1: "Family",
    category_l2: "Daycare",
    color: "#f97316",
    sort_order: null,
    status: "archived",
    is_system: false,
    change_source: "user",
    updated_at: "2026-06-23T10:00:00.000Z",
    created_at: "2026-06-23T10:00:00.000Z",
  });
});

test("buildReassignedCategoryRuleRow preserves rule identity while moving it to the replacement category", () => {
  const row = buildReassignedCategoryRuleRow({
    userId: "user-1",
    now: "2026-06-23T10:00:00.000Z",
    target: {
      id: "groceries",
      label: "Groceries",
      group: "Essential",
      sublabel: "Food at home",
      color: "#8f7cff",
    },
    rule: {
      id: "rule-childcare",
      name: "Daycare -> Childcare",
      description: "Matches daycare charges.",
      priority: 90,
      enabled: true,
      categoryId: "custom-childcare",
      categoryLabel: "Childcare",
      matchStrategy: "merchant_contains",
      matchValue: "daycare",
      confidenceBoost: 0.9,
      hitRate: 0.42,
      lastMatchedAt: null,
    },
  });

  assert.deepEqual(row, {
    user_id: "user-1",
    rule_id: "rule-childcare",
    name: "Daycare -> Childcare",
    description: "Matches daycare charges.",
    priority: 90,
    enabled: true,
    category_id: "groceries",
    category_label: "Groceries",
    match_strategy: "merchant_contains",
    match_value: "daycare",
    confidence_boost: 0.9,
    hit_rate: 0.42,
    last_matched_at: null,
    created_at: "2026-06-23T10:00:00.000Z",
  });
});
