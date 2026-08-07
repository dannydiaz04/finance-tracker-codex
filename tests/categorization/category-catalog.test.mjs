import assert from "node:assert/strict";
import test from "node:test";

import {
  SYSTEM_CATEGORY_IDS,
  isSystemCategoryId,
  mergeCategoryDefinitions,
  slugifyCategoryId,
} from "../../lib/categorization/category-catalog.ts";

const seedCategories = [
  {
    id: "groceries",
    label: "Groceries",
    group: "Essential",
    sublabel: "Food at home",
    color: "#8f7cff",
    sortOrder: 20,
  },
  {
    id: "salary",
    label: "Salary",
    group: "Income",
    sublabel: "Payroll",
    color: "#74ff9f",
    sortOrder: 10,
  },
  {
    id: "travel",
    label: "Travel",
    group: "Lifestyle",
    sublabel: "Trips",
    color: "#ff7c9d",
    sortOrder: null,
  },
];

function categoryRow(overrides = {}) {
  return {
    id: "custom-pets",
    label: "Pets",
    group: "Lifestyle",
    sublabel: "Pet care",
    color: "#f97316",
    sortOrder: 30,
    status: "active",
    isSystem: false,
    ...overrides,
  };
}

test("mergeCategoryDefinitions: seed categories remain system and sort by sortOrder then label", () => {
  const result = mergeCategoryDefinitions(seedCategories, []);

  assert.deepEqual(
    result.map((category) => ({
      id: category.id,
      isSystem: category.isSystem,
      sortOrder: category.sortOrder,
    })),
    [
      { id: "salary", isSystem: true, sortOrder: 10 },
      { id: "groceries", isSystem: true, sortOrder: 20 },
      { id: "travel", isSystem: true, sortOrder: null },
    ],
  );
});

test("mergeCategoryDefinitions: active user rows override seed display fields", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    categoryRow({
      id: "groceries",
      label: "Food",
      group: "Needs",
      sublabel: "Markets",
      color: "#22c55e",
      sortOrder: 5,
      isSystem: false,
    }),
  ]);

  assert.deepEqual(result[0], {
    id: "groceries",
    label: "Food",
    group: "Needs",
    sublabel: "Markets",
    color: "#22c55e",
    isSystem: false,
    sortOrder: 5,
  });
});

test("mergeCategoryDefinitions: user rows add custom categories and fall back to the default color", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    categoryRow({
      id: "custom-health",
      label: "Health",
      color: "",
      sortOrder: 15,
    }),
  ]);

  assert.deepEqual(
    result.map((category) => [category.id, category.color]),
    [
      ["salary", "#74ff9f"],
      ["custom-health", "#64748b"],
      ["groceries", "#8f7cff"],
      ["travel", "#ff7c9d"],
    ],
  );
});

test("mergeCategoryDefinitions: archived rows remove seed and custom categories from the effective catalog", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    categoryRow({ id: "custom-pets", label: "Pets", sortOrder: 12 }),
    categoryRow({ id: "groceries", status: "archived" }),
    categoryRow({ id: "custom-pets", status: "archived" }),
  ]);

  assert.deepEqual(
    result.map((category) => category.id),
    ["salary", "travel"],
  );
});

test("mergeCategoryDefinitions: reserved ids remain system even when a user row says otherwise", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    categoryRow({
      id: "fees",
      label: "Fees",
      group: "Banking",
      isSystem: false,
      sortOrder: 1,
    }),
  ]);

  assert.equal(result[0].id, "fees");
  assert.equal(result[0].isSystem, true);
});

test("isSystemCategoryId: recognizes every reserved system category id", () => {
  for (const categoryId of SYSTEM_CATEGORY_IDS) {
    assert.equal(isSystemCategoryId(categoryId), true, `${categoryId} should be system`);
  }

  assert.equal(isSystemCategoryId("custom-health"), false);
});

test("slugifyCategoryId: builds a stable normalized slug with a collision-resistant suffix", () => {
  const first = slugifyCategoryId("Café au lait", "user-1|2026-06-25T10:00:00.000Z");
  const second = slugifyCategoryId("Café au lait", "user-2|2026-06-25T10:00:00.000Z");

  assert.match(first, /^cafe-au-lait-[a-z0-9]{1,6}$/);
  assert.match(second, /^cafe-au-lait-[a-z0-9]{1,6}$/);
  assert.notEqual(first, second);
});

test("slugifyCategoryId: falls back to category when the label has no slug characters", () => {
  assert.match(slugifyCategoryId("!!!", "user-1|now"), /^category-[a-z0-9]{1,6}$/);
});
