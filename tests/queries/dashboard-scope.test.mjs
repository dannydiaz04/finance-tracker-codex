import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransactionQueryParams,
  normalizeTransactionFilters,
  scopeToTransactionFilters,
  uniqueSearchSuggestions,
} from "../../lib/bigquery/params.ts";
import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("normalizes dashboard transaction filters into stable typed values", () => {
  assert.deepEqual(
    normalizeTransactionFilters({
      query: "  coffee  ",
      accountIds: " acc_1, acc_2 ,, ",
      categoryIds: ["food", "travel"],
      merchant: "  Target ",
      direction: "outflow",
      transactionClass: "expense",
      pending: "posted",
      from: "2026-03-01",
      to: "2026-03-31",
      minAmount: "10.50",
      maxAmount: "not-a-number",
      selectedId: "txn_1",
      excludePlaid: "1",
    }),
    {
      query: "coffee",
      accountIds: ["acc_1", "acc_2"],
      categoryIds: ["food", "travel"],
      merchant: "Target",
      direction: "outflow",
      transactionClass: "expense",
      pending: "posted",
      from: "2026-03-01",
      to: "2026-03-31",
      minAmount: 10.5,
      maxAmount: undefined,
      selectedId: "txn_1",
      excludePlaid: true,
    },
  );
});

test("builds BigQuery transaction params with safe sentinels for empty filters", () => {
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
});

test("preserves explicit account filters and excludePlaid for warehouse queries", () => {
  assert.deepEqual(
    buildTransactionQueryParams({
      accountIds: ["acc_1"],
      categoryIds: ["food"],
      direction: "all",
      transactionClass: "income",
      pending: "pending",
      minAmount: 25,
      maxAmount: 250,
      excludePlaid: true,
    }),
    {
      query: "",
      accountIds: ["acc_1"],
      hasAccountIds: true,
      categoryIds: ["food"],
      hasCategoryIds: true,
      merchant: "",
      direction: "",
      transactionClass: "income",
      pending: "pending",
      from: "",
      to: "",
      minAmount: 25,
      maxAmount: 250,
      excludePlaid: true,
    },
  );
});

test("copies time filter scope into transaction filters including excludePlaid", () => {
  assert.deepEqual(
    scopeToTransactionFilters({
      preset: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
      excludePlaid: true,
    }),
    {
      from: "2026-01-01",
      to: "2026-01-31",
      excludePlaid: true,
    },
  );
});

test("scopes transaction SQL to the signed-in user while allowing anonymous CSV rows only when Plaid is excluded", () => {
  assert.equal(
    transactionUserScopePredicate("t"),
    "(t.user_id = @userId OR (@excludePlaid AND t.user_id IS NULL AND t.source_name = 'csv'))",
  );
});

test("scopes account SQL to signed-in accounts and legacy anonymous CSV account metadata", () => {
  assert.equal(
    accountUserScopePredicate("a"),
    "(a.user_id = @userId OR (a.user_id IS NULL AND a.institution = 'csv'))",
  );
});

test("dedupes anonymous CSV rows by canonical group only after user-bound rows are preferred", () => {
  assert.equal(
    anonymousCsvDedupePredicate("t"),
    "(t.user_id IS NOT NULL OR t.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY t.canonical_group_id ORDER BY t.transaction_id) = 1)",
  );
});

test("dedupes Plaid canonical rows without collapsing same-amount transactions across users", () => {
  assert.equal(
    plaidCanonicalDedupePredicate("t"),
    "(t.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY t.user_id, t.source_name, t.canonical_group_id, t.signed_amount ORDER BY t.pending, t.transaction_id) = 1)",
  );
});

test("deduplicates search suggestions by case-insensitive label and type", () => {
  assert.deepEqual(
    uniqueSearchSuggestions([
      { type: "merchant", label: "Target" },
      { type: "merchant", label: "target" },
      { type: "category", label: "Target" },
    ]),
    [
      { type: "merchant", label: "Target" },
      { type: "category", label: "Target" },
    ],
  );
});
