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
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";
import {
  buildTimeFilterQueryParams,
  copyTimeFilterParams,
  normalizeTimeFilter,
  timeFilterToSearchString,
} from "../../lib/time-filter.ts";

test("normalizes transaction filter query params for BigQuery sentinels", () => {
  const filters = normalizeTransactionFilters({
    query: "  grocery  ",
    accountIds: "checking, savings ,,",
    categoryIds: ["dining", "bills"],
    direction: "outflow",
    transactionClass: "expense",
    pending: "posted",
    minAmount: "10.5",
    maxAmount: "not-a-number",
    excludePlaid: "1",
  });

  assert.deepEqual(filters, {
    query: "grocery",
    accountIds: ["checking", "savings"],
    categoryIds: ["dining", "bills"],
    merchant: undefined,
    direction: "outflow",
    transactionClass: "expense",
    pending: "posted",
    from: undefined,
    to: undefined,
    minAmount: 10.5,
    maxAmount: undefined,
    selectedId: undefined,
    excludePlaid: true,
  });

  assert.deepEqual(buildTransactionQueryParams(filters), {
    query: "grocery",
    accountIds: ["checking", "savings"],
    hasAccountIds: true,
    categoryIds: ["dining", "bills"],
    hasCategoryIds: true,
    merchant: "",
    direction: "outflow",
    transactionClass: "expense",
    pending: "posted",
    from: "",
    to: "",
    minAmount: 10.5,
    maxAmount: -1,
    excludePlaid: true,
  });
});

test("carries excludePlaid through dashboard time-filter helpers", () => {
  const filter = normalizeTimeFilter({
    month: "2026-03",
    excludePlaid: "true",
  });

  assert.deepEqual(filter, {
    from: "2026-03-01",
    to: "2026-03-31",
    month: "2026-03",
    preset: "custom",
    excludePlaid: true,
  });
  assert.deepEqual(buildTimeFilterQueryParams(filter), {
    from: "2026-03-01",
    to: "2026-03-31",
    excludePlaid: true,
  });
  assert.deepEqual(scopeToTransactionFilters(filter), {
    from: "2026-03-01",
    to: "2026-03-31",
    excludePlaid: true,
  });
  assert.equal(
    timeFilterToSearchString(filter),
    "from=2026-03-01&to=2026-03-31&month=2026-03&timePreset=custom&excludePlaid=true",
  );

  const copied = copyTimeFilterParams(
    new URLSearchParams(
      "from=2026-03-01&to=2026-03-31&excludePlaid=true&query=rent",
    ),
  );

  assert.equal(copied.toString(), "from=2026-03-01&to=2026-03-31&excludePlaid=true");
});

test("builds user-scope predicates that safely hydrate CSV-only rows", () => {
  assert.equal(
    transactionUserScopePredicate("t"),
    "(t.user_id = @userId OR (@excludePlaid AND t.user_id IS NULL AND t.source_name = 'csv'))",
  );
  assert.equal(
    anonymousCsvDedupePredicate(),
    "(user_id IS NOT NULL OR source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY canonical_group_id ORDER BY transaction_id) = 1)",
  );
  assert.equal(
    plaidCanonicalDedupePredicate("tx"),
    "(tx.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY tx.user_id, tx.source_name, tx.canonical_group_id, tx.signed_amount ORDER BY tx.pending, tx.transaction_id) = 1)",
  );
});

test("dedupes search suggestions by type and case-insensitive label", () => {
  assert.deepEqual(
    uniqueSearchSuggestions([
      { type: "merchant", label: "Target" },
      { type: "merchant", label: "target" },
      { type: "category", label: "Target" },
    ]),
    [
      { type: "merchant", label: "target" },
      { type: "category", label: "Target" },
    ],
  );
});
