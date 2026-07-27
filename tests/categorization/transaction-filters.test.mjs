import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransactionQueryParams,
  normalizeTransactionFilters,
} from "../../lib/bigquery/params.ts";

test("normalizes category and subcategory URL filters independently", () => {
  const filters = normalizeTransactionFilters({
    categoryGroups: " lifestyle-abc123, essential-def456 ",
    categoryIds: "dining,travel",
  });

  assert.deepEqual(filters.categoryGroupIds, [
    "lifestyle-abc123",
    "essential-def456",
  ]);
  assert.deepEqual(filters.categoryIds, ["dining", "travel"]);
});

test("builds BigQuery parameters for parent-only category filtering", () => {
  const params = buildTransactionQueryParams({
    categoryGroupLabels: ["Lifestyle"],
  });

  assert.equal(params.hasCategoryGroups, true);
  assert.deepEqual(params.categoryGroups, ["lifestyle"]);
  assert.equal(params.hasCategoryIds, false);
  assert.deepEqual(params.categoryIds, [""]);
});

test("builds combined category and subcategory query parameters", () => {
  const params = buildTransactionQueryParams({
    categoryGroupLabels: ["Lifestyle"],
    categoryIds: ["dining"],
  });

  assert.equal(params.hasCategoryGroups, true);
  assert.equal(params.hasCategoryIds, true);
  assert.deepEqual(params.categoryGroups, ["lifestyle"]);
  assert.deepEqual(params.categoryIds, ["dining"]);
});
