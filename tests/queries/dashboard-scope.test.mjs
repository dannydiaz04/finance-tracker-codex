import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransactionQueryParams,
  normalizeTransactionFilters,
  scopeToTransactionFilters,
} from "../../lib/bigquery/params.ts";
import {
  buildTimeFilterQueryParams,
  copyTimeFilterParams,
  normalizeTimeFilter,
  timeFilterToSearchString,
} from "../../lib/time-filter.ts";
import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("normalizeTransactionFilters parses list, amount, and exclude-Plaid filters", () => {
  const filters = normalizeTransactionFilters({
    query: "  groceries  ",
    accountIds: "checking, savings, ,",
    categoryIds: ["food", " dining "],
    direction: "outflow",
    transactionClass: "expense",
    pending: "posted",
    minAmount: "12.5",
    maxAmount: "not-a-number",
    selectedId: "txn-123",
    excludePlaid: "1",
  });

  assert.deepEqual(filters, {
    query: "groceries",
    accountIds: ["checking", "savings"],
    categoryIds: ["food", "dining"],
    direction: "outflow",
    transactionClass: "expense",
    pending: "posted",
    from: undefined,
    to: undefined,
    minAmount: 12.5,
    maxAmount: undefined,
    selectedId: "txn-123",
    excludePlaid: true,
  });
});

test("buildTransactionQueryParams preserves BigQuery sentinels and exclude-Plaid boolean", () => {
  assert.deepEqual(
    buildTransactionQueryParams({
      query: "groceries",
      accountIds: ["checking"],
      direction: "all",
      pending: "posted",
      from: "2026-04-01",
      excludePlaid: true,
    }),
    {
      query: "groceries",
      accountIds: ["checking"],
      hasAccountIds: true,
      categoryIds: [""],
      hasCategoryIds: false,
      merchant: "",
      direction: "",
      transactionClass: "",
      pending: "posted",
      from: "2026-04-01",
      to: "",
      minAmount: -1,
      maxAmount: -1,
      excludePlaid: true,
    },
  );
});

test("time filters carry dashboard-wide exclude-Plaid scope through params and URLs", () => {
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
});

test("copyTimeFilterParams copies only dashboard scope keys including exclude-Plaid", () => {
  const copied = copyTimeFilterParams(
    new URLSearchParams(
      "from=2026-04-01&to=2026-04-30&timePreset=custom&excludePlaid=true&query=ignored",
    ),
  );

  assert.equal(
    copied.toString(),
    "from=2026-04-01&to=2026-04-30&timePreset=custom&excludePlaid=true",
  );
});

test("user scope predicates include anonymous CSV hydration and duplicate guards", () => {
  assert.equal(
    transactionUserScopePredicate("txn"),
    "(txn.user_id = @userId OR (@excludePlaid AND txn.user_id IS NULL AND txn.source_name = 'csv'))",
  );
  assert.equal(
    accountUserScopePredicate("acct"),
    "(acct.user_id = @userId OR (acct.user_id IS NULL AND acct.institution = 'csv'))",
  );
  assert.equal(
    anonymousCsvDedupePredicate("txn"),
    "(txn.user_id IS NOT NULL OR txn.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY txn.canonical_group_id ORDER BY txn.transaction_id) = 1)",
  );
  assert.equal(
    plaidCanonicalDedupePredicate("txn"),
    "(txn.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY txn.user_id, txn.source_name, txn.canonical_group_id, txn.signed_amount ORDER BY txn.pending, txn.transaction_id) = 1)",
  );
});
