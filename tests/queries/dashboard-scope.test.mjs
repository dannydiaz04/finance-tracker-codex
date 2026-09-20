import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransactionQueryParams,
  normalizeTransactionFilters,
  scopeToTransactionFilters,
  uniqueSearchSuggestions,
} from "../../lib/bigquery/params.ts";
import {
  anonymousCsvDedupePredicate,
  accountUserScopePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";
import {
  buildTimeFilterQueryParams,
  copyTimeFilterParams,
  normalizeTimeFilter,
  timeFilterToSearchString,
} from "../../lib/time-filter.ts";

test("normalizes transaction filters and carries the exclude-Plaid scope", () => {
  assert.deepEqual(
    normalizeTransactionFilters({
      query: "  grocery  ",
      accountIds: "checking, savings,, ",
      categoryIds: ["food", "travel"],
      direction: "outflow",
      transactionClass: "expense",
      pending: "posted",
      from: "2026-06-01",
      to: "2026-06-30",
      minAmount: "10.50",
      maxAmount: "not-a-number",
      excludePlaid: "1",
    }),
    {
      query: "grocery",
      accountIds: ["checking", "savings"],
      categoryIds: ["food", "travel"],
      merchant: undefined,
      direction: "outflow",
      transactionClass: "expense",
      pending: "posted",
      from: "2026-06-01",
      to: "2026-06-30",
      minAmount: 10.5,
      maxAmount: undefined,
      selectedId: undefined,
      excludePlaid: true,
    },
  );
});

test("builds safe BigQuery params for empty filters and scoped filters", () => {
  assert.deepEqual(buildTransactionQueryParams({}), {
    query: "",
    accountIds: [""],
    hasAccountIds: false,
    categoryIds: [""],
    hasCategoryIds: false,
    merchant: "",
    direction: "",
    transactionClass: "",
    pending: "",
    from: "",
    to: "",
    minAmount: -1,
    maxAmount: -1,
    excludePlaid: false,
  });

  assert.deepEqual(
    buildTransactionQueryParams({
      accountIds: ["checking"],
      categoryIds: ["food"],
      direction: "outflow",
      transactionClass: "expense",
      pending: "pending",
      from: "2026-06-01",
      to: "2026-06-30",
      minAmount: 25,
      maxAmount: 500,
      excludePlaid: true,
    }),
    {
      query: "",
      accountIds: ["checking"],
      hasAccountIds: true,
      categoryIds: ["food"],
      hasCategoryIds: true,
      merchant: "",
      direction: "outflow",
      transactionClass: "expense",
      pending: "pending",
      from: "2026-06-01",
      to: "2026-06-30",
      minAmount: 25,
      maxAmount: 500,
      excludePlaid: true,
    },
  );
});

test("propagates exclude-Plaid through time filter helpers", () => {
  const filter = normalizeTimeFilter({
    month: "2026-06",
    excludePlaid: "true",
  });

  assert.deepEqual(filter, {
    from: "2026-06-01",
    to: "2026-06-30",
    month: "2026-06",
    preset: "custom",
    excludePlaid: true,
  });
  assert.deepEqual(buildTimeFilterQueryParams(filter), {
    from: "2026-06-01",
    to: "2026-06-30",
    excludePlaid: true,
  });
  assert.deepEqual(scopeToTransactionFilters(filter), {
    from: "2026-06-01",
    to: "2026-06-30",
    excludePlaid: true,
  });

  const search = new URLSearchParams(timeFilterToSearchString(filter));
  assert.equal(search.get("month"), "2026-06");
  assert.equal(search.get("excludePlaid"), "true");
});

test("copies dashboard scope params without unrelated transaction filters", () => {
  const source = new URLSearchParams({
    from: "2026-06-01",
    to: "2026-06-30",
    timePreset: "custom",
    excludePlaid: "true",
    query: "coffee",
  });
  const target = copyTimeFilterParams(source);

  assert.equal(target.get("from"), "2026-06-01");
  assert.equal(target.get("to"), "2026-06-30");
  assert.equal(target.get("timePreset"), "custom");
  assert.equal(target.get("excludePlaid"), "true");
  assert.equal(target.get("query"), null);
});

test("keeps warehouse predicates scoped to the current user and dedupe keys", () => {
  assert.equal(
    transactionUserScopePredicate("txn"),
    "(txn.user_id = @userId OR (@excludePlaid AND txn.user_id IS NULL AND txn.source_name = 'csv'))",
  );
  assert.equal(
    accountUserScopePredicate("acct"),
    "(acct.user_id = @userId OR (acct.user_id IS NULL AND acct.institution = 'csv'))",
  );
  assert.match(
    anonymousCsvDedupePredicate("txn"),
    /PARTITION BY txn\.canonical_group_id ORDER BY txn\.transaction_id/,
  );
  assert.match(
    plaidCanonicalDedupePredicate("txn"),
    /PARTITION BY txn\.user_id, txn\.source_name, txn\.canonical_group_id, txn\.signed_amount ORDER BY txn\.pending, txn\.transaction_id/,
  );
});

test("dedupes search suggestions case-insensitively per suggestion type", () => {
  assert.deepEqual(
    uniqueSearchSuggestions([
      { label: "Coffee Shop", type: "merchant" },
      { label: "coffee shop", type: "merchant" },
      { label: "Coffee Shop", type: "keyword" },
    ]),
    [
      { label: "coffee shop", type: "merchant" },
      { label: "Coffee Shop", type: "keyword" },
    ],
  );
});
