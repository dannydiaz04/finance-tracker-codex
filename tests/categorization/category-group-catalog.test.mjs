import assert from "node:assert/strict";
import test from "node:test";

import {
  allocateCategoryGroupId,
  buildCategoryGroupDefinitionRow,
  deriveCategoryGroups,
  mergeCategoryGroupDefinitions,
  resolveCategoryGroupFilterRefs,
  slugifyCategoryGroupId,
} from "../../lib/categorization/category-group-catalog.ts";
import { buildCategoryDefinitionRow } from "../../lib/categorization/category-catalog.ts";

test("derives unique, trimmed parent categories from subcategories", () => {
  const groups = deriveCategoryGroups([
    {
      group: " Lifestyle ",
      color: "#111111",
      isSystem: true,
      sortOrder: null,
    },
    {
      group: "Lifestyle",
      color: "#222222",
      isSystem: false,
      sortOrder: null,
    },
    {
      group: "Essential",
      color: "#333333",
      isSystem: true,
      sortOrder: null,
    },
  ]);

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Essential", "Lifestyle"],
  );
  assert.equal(groups.find((group) => group.label === "Lifestyle")?.color, "#111111");
});

test("dedicated definitions rename seed groups and preserve empty custom categories", () => {
  const merged = mergeCategoryGroupDefinitions(
    [
      {
        id: "essential",
        label: "Essential",
        color: "#111111",
        isSystem: true,
        sortOrder: null,
      },
    ],
    [
      {
        id: "needs",
        label: "Needs",
        color: "#222222",
        isSystem: true,
        sortOrder: null,
      },
      {
        id: "family",
        label: "Family",
        color: "#333333",
        isSystem: false,
        sortOrder: null,
      },
    ],
    [
      {
        id: "essential",
        label: "Needs",
        color: "#444444",
        sortOrder: 2,
        status: "active",
        isSystem: true,
      },
      {
        id: "future-goals-a1",
        label: "Future Goals",
        color: "#555555",
        sortOrder: 1,
        status: "active",
        isSystem: false,
      },
    ],
  );

  assert.deepEqual(
    merged.map((group) => group.label),
    ["Future Goals", "Needs", "Family"],
  );
  assert.equal(merged.filter((group) => group.label === "Needs").length, 1);
  assert.equal(merged.find((group) => group.id === "essential")?.isSystem, true);
});

test("archived definitions remove inferred legacy categories", () => {
  const merged = mergeCategoryGroupDefinitions(
    [],
    [
      {
        id: "family",
        label: "Family",
        color: "#333333",
        isSystem: false,
        sortOrder: null,
      },
    ],
    [
      {
        id: "family",
        label: "Family",
        color: "#333333",
        sortOrder: null,
        status: "archived",
        isSystem: false,
      },
    ],
  );

  assert.deepEqual(merged, []);
});

test("category group ids are stable and user ids avoid the seed namespace", () => {
  assert.match(slugifyCategoryGroupId("Future Goals"), /^future-goals-[a-z0-9]+$/);
  assert.equal(
    slugifyCategoryGroupId("Future Goals", "user-1|now"),
    slugifyCategoryGroupId("Future Goals", "user-1|now"),
  );
  assert.notEqual(
    slugifyCategoryGroupId("Future Goals", "user-1|now"),
    slugifyCategoryGroupId("Future Goals", "user-2|now"),
  );
  assert.notEqual(
    slugifyCategoryGroupId("Home & Auto"),
    slugifyCategoryGroupId("Home Auto"),
  );
});

test("category group allocation is idempotent and skips ids retained by renamed groups", () => {
  const firstId = allocateCategoryGroupId("Future Goals", "user-1", []);

  assert.equal(
    firstId,
    allocateCategoryGroupId("Future Goals", "user-1", []),
  );
  assert.notEqual(
    firstId,
    allocateCategoryGroupId("Future Goals", "user-2", []),
  );

  const nextId = allocateCategoryGroupId("Future Goals", "user-1", [
    { id: firstId, label: "Renamed Goals" },
  ]);
  assert.notEqual(nextId, firstId);
  assert.equal(
    nextId,
    allocateCategoryGroupId("Future Goals", "user-1", [
      { id: firstId, label: "Renamed Goals" },
    ]),
  );
});

test("category filter refs resolve stable ids and legacy labels", () => {
  const categoryGroups = [
    { id: "essential-abc123", label: "Needs" },
    { id: "future-goals-def456", label: "Future Goals" },
  ];

  assert.deepEqual(
    resolveCategoryGroupFilterRefs(
      ["essential-abc123", " future goals ", "missing-id"],
      categoryGroups,
    ),
    {
      ids: ["essential-abc123", "future-goals-def456"],
      labels: ["Needs", "Future Goals", "missing-id"],
    },
  );
});

test("builds append-only parent category definition rows", () => {
  assert.deepEqual(
    buildCategoryGroupDefinitionRow({
      userId: "user-1",
      categoryGroup: {
        id: "future-goals-a1",
        label: "Future Goals",
        color: "#22c55e",
        sortOrder: null,
      },
      status: "active",
      isSystem: false,
      now: "2026-07-27T22:00:00.000Z",
    }),
    {
      user_id: "user-1",
      category_group_id: "future-goals-a1",
      label: "Future Goals",
      color: "#22c55e",
      sort_order: null,
      status: "active",
      is_system: false,
      change_source: "user",
      updated_at: "2026-07-27T22:00:00.000Z",
      created_at: "2026-07-27T22:00:00.000Z",
    },
  );
});

test("moving a subcategory preserves its identity and changes only its parent", () => {
  const row = buildCategoryDefinitionRow({
    userId: "user-1",
    category: {
      id: "dining",
      label: "Dining",
      group: "Essential",
      sublabel: "Restaurants",
      color: "#4cf2c5",
      sortOrder: 3,
    },
    status: "active",
    isSystem: true,
    now: "2026-07-27T22:00:00.000Z",
  });

  assert.deepEqual(row, {
    user_id: "user-1",
    category_id: "dining",
    label: "Dining",
    category_l1: "Essential",
    category_l2: "Restaurants",
    color: "#4cf2c5",
    sort_order: 3,
    status: "active",
    is_system: true,
    change_source: "user",
    updated_at: "2026-07-27T22:00:00.000Z",
    created_at: "2026-07-27T22:00:00.000Z",
  });
});
