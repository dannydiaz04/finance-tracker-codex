import assert from "node:assert/strict";
import test from "node:test";

import {
  isSystemCategoryId,
  mergeCategoryDefinitions,
  slugifyCategoryId,
} from "../../lib/categorization/category-catalog.ts";

const seedCategories = [
  {
    id: "groceries",
    label: "Groceries",
    group: "Needs",
    sublabel: "Food staples",
    color: "#22c55e",
    sortOrder: 20,
  },
  {
    id: "uncategorized",
    label: "Uncategorized",
    group: "System",
    sublabel: "",
    color: "#94a3b8",
    sortOrder: null,
  },
  {
    id: "dining",
    label: "Dining",
    group: "Lifestyle",
    sublabel: "Restaurants",
    color: "#f97316",
    sortOrder: 10,
    isSystem: false,
  },
];

test("mergeCategoryDefinitions overlays active user rows and preserves system semantics", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    {
      id: "groceries",
      label: "Groceries & Markets",
      group: "Needs",
      sublabel: "Food",
      color: "",
      sortOrder: 5,
      status: "active",
      isSystem: false,
    },
    {
      id: "travel",
      label: "Travel",
      group: "Lifestyle",
      sublabel: "Flights and hotels",
      color: "#0ea5e9",
      sortOrder: 15,
      status: "active",
      isSystem: false,
    },
    {
      id: "salary",
      label: "Paycheck",
      group: "Income",
      sublabel: "",
      color: "#84cc16",
      sortOrder: 1,
      status: "active",
      isSystem: false,
    },
  ]);

  assert.deepEqual(
    result.map((category) => category.id),
    ["salary", "groceries", "dining", "travel", "uncategorized"],
  );

  assert.deepEqual(
    result.find((category) => category.id === "groceries"),
    {
      id: "groceries",
      label: "Groceries & Markets",
      group: "Needs",
      sublabel: "Food",
      color: "#64748b",
      sortOrder: 5,
      isSystem: false,
    },
  );

  assert.equal(
    result.find((category) => category.id === "salary")?.isSystem,
    true,
    "reserved category ids keep warehouse/system semantics even when user-defined",
  );
});

test("mergeCategoryDefinitions removes archived categories and sorts null orders by label", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    {
      id: "dining",
      label: "Dining",
      group: "Lifestyle",
      sublabel: "Restaurants",
      color: "#f97316",
      sortOrder: 10,
      status: "archived",
      isSystem: false,
    },
    {
      id: "charity",
      label: "Charity",
      group: "Giving",
      sublabel: "",
      color: "#a855f7",
      sortOrder: null,
      status: "active",
      isSystem: false,
    },
  ]);

  assert.deepEqual(
    result.map((category) => category.id),
    ["groceries", "charity", "uncategorized"],
  );
  assert.equal(result.some((category) => category.id === "dining"), false);
});

test("slugifyCategoryId is stable, URL-safe, and keeps same labels collision-resistant", () => {
  const cafeId = slugifyCategoryId("  Cafes & Coffee!  ", "user-1|2026");

  assert.equal(cafeId, slugifyCategoryId("  Cafes & Coffee!  ", "user-1|2026"));
  assert.match(cafeId, /^cafes-coffee-[a-z0-9]+$/);
  assert.match(slugifyCategoryId("旅行 ✈️", "user-1|2026"), /^category-[a-z0-9]+$/);
  assert.notEqual(slugifyCategoryId("Travel", "seed-a"), slugifyCategoryId("Travel", "seed-b"));
});

test("isSystemCategoryId recognizes protected warehouse categories", () => {
  assert.equal(isSystemCategoryId("uncategorized"), true);
  assert.equal(isSystemCategoryId("credit-card-payment"), true);
  assert.equal(isSystemCategoryId("travel"), false);
});
