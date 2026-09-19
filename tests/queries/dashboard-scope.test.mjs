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

test("normalizeTransactionFilters trims array-like filters and preserves excludePlaid", () => {
  assert.deepEqual(
    normalizeTransactionFilters({
      query: "  coffee  ",
      accountIds: " checking-1, , savings-1 ",
      categoryIds: [" groceries ", " dining "],
      merchant: "  Local Cafe  ",
      direction: "outflow",
      transactionClass: "expense",
      pending: "posted",
      minAmount: "10.50",
      maxAmount: "not-a-number",
      selectedId: "txn-1",
      excludePlaid: "1",
    }),
    {
      query: "coffee",
      accountIds: ["checking-1", "savings-1"],
      categoryIds: ["groceries", "dining"],
      merchant: "Local Cafe",
      direction: "outflow",
      transactionClass: "expense",
      pending: "posted",
      from: undefined,
      to: undefined,
      minAmount: 10.5,
      maxAmount: undefined,
      selectedId: "txn-1",
      excludePlaid: true,
    },
  );
});

test("buildTransactionQueryParams uses BigQuery-safe sentinels for empty filters", () => {
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
      accountIds: ["checking-1"],
      categoryIds: ["groceries"],
      direction: "inflow",
      transactionClass: "income",
      pending: "pending",
      from: "2026-04-01",
      to: "2026-04-30",
      minAmount: 5,
      maxAmount: 100,
      excludePlaid: true,
    }),
    {
      query: "",
      accountIds: ["checking-1"],
      hasAccountIds: true,
      categoryIds: ["groceries"],
      hasCategoryIds: true,
      merchant: "",
      direction: "inflow",
      transactionClass: "income",
      pending: "pending",
      from: "2026-04-01",
      to: "2026-04-30",
      minAmount: 5,
      maxAmount: 100,
      excludePlaid: true,
    },
  );
});

test("time filter helpers carry excludePlaid across dashboard links and query params", () => {
  const filter = normalizeTimeFilter({
    month: "2026-04",
    timePreset: "all",
    excludePlaid: "true",
  });

  assert.deepEqual(filter, {
    from: "2026-04-01",
    to: "2026-04-30",
    month: "2026-04",
    preset: "custom",
    excludePlaid: true,
  });
  assert.deepEqual(buildTimeFilterQueryParams(filter), {
    from: "2026-04-01",
    to: "2026-04-30",
    excludePlaid: true,
  });
  assert.deepEqual(scopeToTransactionFilters(filter), {
    from: "2026-04-01",
    to: "2026-04-30",
    excludePlaid: true,
  });
  assert.equal(
    timeFilterToSearchString(filter),
    "from=2026-04-01&to=2026-04-30&month=2026-04&timePreset=custom&excludePlaid=true",
  );

  const copied = copyTimeFilterParams(
    new URLSearchParams(
      "query=coffee&from=2026-04-01&to=2026-04-30&month=2026-04&excludePlaid=true",
    ),
    new URLSearchParams("view=monthly"),
  );

  assert.equal(
    copied.toString(),
    "view=monthly&from=2026-04-01&to=2026-04-30&month=2026-04&excludePlaid=true",
  );
});

test("user-scope predicates include CSV-only fallback without broadening Plaid access", () => {
  assert.equal(
    transactionUserScopePredicate("txn"),
    "(txn.user_id = @userId OR (@excludePlaid AND txn.user_id IS NULL AND txn.source_name = 'csv'))",
  );
  assert.equal(
    accountUserScopePredicate("account"),
    "(account.user_id = @userId OR (account.user_id IS NULL AND account.institution = 'csv'))",
  );
});

test("dedupe predicates partition by canonical identity and user/source ownership", () => {
  assert.equal(
    anonymousCsvDedupePredicate("txn"),
    "(txn.user_id IS NOT NULL OR txn.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY txn.canonical_group_id ORDER BY txn.transaction_id) = 1)",
  );
  assert.equal(
    plaidCanonicalDedupePredicate("txn"),
    "(txn.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY txn.user_id, txn.source_name, txn.canonical_group_id, txn.signed_amount ORDER BY txn.pending, txn.transaction_id) = 1)",
  );
});

test("uniqueSearchSuggestions dedupes labels case-insensitively per type", () => {
  assert.deepEqual(
    uniqueSearchSuggestions([
      { label: "Target", type: "merchant" },
      { label: "target", type: "merchant" },
      { label: "Target", type: "keyword" },
      { label: "Groceries", type: "category" },
    ]),
    [
      { label: "target", type: "merchant" },
      { label: "Target", type: "keyword" },
      { label: "Groceries", type: "category" },
    ],
  );
});
