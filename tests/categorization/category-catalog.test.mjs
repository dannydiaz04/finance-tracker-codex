import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCategoryDefinitions,
  slugifyCategoryId,
} from "../../lib/categorization/category-catalog.ts";

const seedCategories = [
  {
    id: "dining",
    label: "Dining",
    group: "Lifestyle",
    sublabel: "Restaurants",
    color: "#f97316",
    sortOrder: 2,
    isSystem: true,
  },
  {
    id: "coffee",
    label: "Coffee",
    group: "Lifestyle",
    sublabel: "Coffee shops",
    color: "#92400e",
    sortOrder: 3,
    isSystem: false,
  },
  {
    id: "salary",
    label: "Salary",
    group: "Income",
    sublabel: "Paychecks",
    color: "#22c55e",
    sortOrder: null,
  },
];

function userCategoryRow(overrides) {
  return {
    id: "home-office",
    label: "Home Office",
    group: "Work",
    sublabel: "Supplies",
    color: "#64748b",
    sortOrder: null,
    status: "active",
    isSystem: false,
    ...overrides,
  };
}

test("mergeCategoryDefinitions applies active overrides and archived removals", () => {
  const merged = mergeCategoryDefinitions(seedCategories, [
    userCategoryRow({
      id: "dining",
      label: "Restaurants",
      group: "Essential",
      sublabel: "Dining out",
      color: "#0ea5e9",
      sortOrder: 1,
      isSystem: true,
    }),
    userCategoryRow({
      id: "coffee",
      label: "Coffee",
      status: "archived",
    }),
    userCategoryRow({
      color: "",
    }),
    userCategoryRow({
      id: "salary",
      label: "Paycheck",
      group: "Income",
      sublabel: "Payroll",
      color: "#16a34a",
      isSystem: false,
    }),
  ]);

  assert.deepEqual(
    merged.map((category) => category.id),
    ["dining", "home-office", "salary"],
  );

  assert.deepEqual(merged[0], {
    id: "dining",
    label: "Restaurants",
    group: "Essential",
    sublabel: "Dining out",
    color: "#0ea5e9",
    sortOrder: 1,
    isSystem: true,
  });
  assert.equal(
    merged.find((category) => category.id === "home-office")?.color,
    "#64748b",
  );
  assert.equal(
    merged.find((category) => category.id === "salary")?.isSystem,
    true,
  );
});

test("mergeCategoryDefinitions sorts null sort orders last by label", () => {
  const merged = mergeCategoryDefinitions([], [
    userCategoryRow({ id: "z", label: "Zebra", sortOrder: null }),
    userCategoryRow({ id: "a", label: "Alpha", sortOrder: null }),
    userCategoryRow({ id: "m", label: "Middle", sortOrder: 10 }),
  ]);

  assert.deepEqual(
    merged.map((category) => category.id),
    ["m", "a", "z"],
  );
});

test("slugifyCategoryId is stable, label-based, and seed-collision resistant", () => {
  assert.match(
    slugifyCategoryId("Future Goals", "user-1|Future Goals"),
    /^future-goals-[a-z0-9]+$/,
  );
  assert.equal(
    slugifyCategoryId("Future Goals", "user-1|Future Goals"),
    slugifyCategoryId("Future Goals", "user-1|Future Goals"),
  );
  assert.notEqual(
    slugifyCategoryId("Future Goals", "user-1|Future Goals"),
    slugifyCategoryId("Future Goals", "user-2|Future Goals"),
  );
  assert.match(slugifyCategoryId("!!!", "user-1|symbol-only"), /^category-/);
});
