import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransactionQueryParams,
  normalizeTransactionFilters,
} from "../../lib/bigquery/params.ts";

test("normalizes category and subcategory URL filters independently", () => {
  const filters = normalizeTransactionFilters({
    categoryGroups: " Lifestyle, Essential ",
    categoryIds: "dining,travel",
  });

  assert.deepEqual(filters.categoryGroups, ["Lifestyle", "Essential"]);
  assert.deepEqual(filters.categoryIds, ["dining", "travel"]);
});

test("builds BigQuery parameters for parent-only category filtering", () => {
  const params = buildTransactionQueryParams({
    categoryGroups: ["Lifestyle"],
  });

  assert.equal(params.hasCategoryGroups, true);
  assert.deepEqual(params.categoryGroups, ["Lifestyle"]);
  assert.equal(params.hasCategoryIds, false);
  assert.deepEqual(params.categoryIds, [""]);
});

test("builds combined category and subcategory query parameters", () => {
  const params = buildTransactionQueryParams({
    categoryGroups: ["Lifestyle"],
    categoryIds: ["dining"],
  });

  assert.equal(params.hasCategoryGroups, true);
  assert.equal(params.hasCategoryIds, true);
  assert.deepEqual(params.categoryGroups, ["Lifestyle"]);
  assert.deepEqual(params.categoryIds, ["dining"]);
});
