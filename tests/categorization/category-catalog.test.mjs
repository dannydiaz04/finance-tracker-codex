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
    sortOrder: 20,
  },
];

function userDefinition(overrides = {}) {
  return {
    id: "home-goods-user",
    label: "Home Goods",
    group: "Lifestyle",
    sublabel: "Decor",
    color: "#123456",
    sortOrder: null,
    status: "active",
    isSystem: false,
    ...overrides,
  };
}

test("system category ids cover warehouse semantic fallbacks", () => {
  assert.equal(isSystemCategoryId("uncategorized"), true);
  assert.equal(isSystemCategoryId("transfers"), true);
  assert.equal(isSystemCategoryId("credit-card-payment"), true);
  assert.equal(isSystemCategoryId("fees"), true);
  assert.equal(isSystemCategoryId("salary"), true);
  assert.equal(isSystemCategoryId("groceries"), false);
});

test("user definitions override seed display fields while preserving system status", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    userDefinition({
      id: "salary",
      label: "Paychecks",
      group: "Income",
      sublabel: "Direct deposit",
      color: "#00ff00",
      sortOrder: 5,
      isSystem: false,
    }),
  ]);

  const salary = result.find((category) => category.id === "salary");
  assert.deepEqual(salary, {
    id: "salary",
    label: "Paychecks",
    group: "Income",
    sublabel: "Direct deposit",
    color: "#00ff00",
    sortOrder: 5,
    isSystem: true,
  });
});

test("archived user rows remove custom categories from the effective catalog", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    userDefinition({ id: "gifts", label: "Gifts", sortOrder: 10 }),
    userDefinition({ id: "gifts", label: "Gifts", sortOrder: 10, status: "archived" }),
  ]);

  assert.equal(result.some((category) => category.id === "gifts"), false);
  assert.equal(result.some((category) => category.id === "groceries"), true);
});

test("active user rows add custom categories with fallback colors and deterministic sorting", () => {
  const result = mergeCategoryDefinitions(seedCategories, [
    userDefinition({
      id: "wellness",
      label: "Wellness",
      group: "Lifestyle",
      sublabel: "Fitness",
      color: "",
      sortOrder: 10,
    }),
    userDefinition({
      id: "auto",
      label: "Auto",
      group: "Lifestyle",
      sublabel: "Fuel",
      sortOrder: null,
    }),
  ]);

  assert.deepEqual(
    result.map((category) => category.id),
    ["wellness", "travel", "auto", "groceries", "salary"],
  );

  assert.equal(result.find((category) => category.id === "wellness")?.color, "#64748b");
});

test("slugified category ids are stable, normalized, and seed-dependent", () => {
  assert.equal(slugifyCategoryId(" Travel & Dining! ", "user-1|2026-06-24"), "travel-dining-19gksr");
  assert.equal(slugifyCategoryId(" Travel & Dining! ", "user-1|2026-06-24"), "travel-dining-19gksr");
  assert.notEqual(
    slugifyCategoryId(" Travel & Dining! ", "user-1|2026-06-24"),
    slugifyCategoryId(" Travel & Dining! ", "user-2|2026-06-24"),
  );
});

test("slugified category ids keep empty labels out of the seed namespace", () => {
  assert.match(slugifyCategoryId("!!!", "user-1|2026-06-24"), /^category-[a-z0-9]+$/);
});
