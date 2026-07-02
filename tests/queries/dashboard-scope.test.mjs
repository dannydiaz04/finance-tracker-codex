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

test("normalizeTransactionFilters parses list, amount, and Plaid exclusion search params", () => {
  const filters = normalizeTransactionFilters({
    query: "  grocery  ",
    accountIds: "checking, savings,",
    categoryIds: ["food,utilities"],
    direction: "outflow",
    minAmount: "25.50",
    maxAmount: "not-a-number",
    excludePlaid: "1",
  });

  assert.deepEqual(filters, {
    query: "grocery",
    accountIds: ["checking", "savings"],
    categoryIds: ["food", "utilities"],
    merchant: undefined,
    direction: "outflow",
    transactionClass: "all",
    pending: "all",
    from: undefined,
    to: undefined,
    minAmount: 25.5,
    maxAmount: undefined,
    selectedId: undefined,
    excludePlaid: true,
  });
});

test("buildTransactionQueryParams uses sentinels for empty filters and propagates excludePlaid", () => {
  assert.deepEqual(
    buildTransactionQueryParams({
      direction: "all",
      transactionClass: "all",
      pending: "all",
      excludePlaid: true,
    }),
    {
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
      excludePlaid: true,
    },
  );
});

test("time filter helpers preserve excludePlaid across dashboard scope links and query params", () => {
  const filter = normalizeTimeFilter({
    month: "2026-04",
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

  const copied = copyTimeFilterParams(
    new URLSearchParams(timeFilterToSearchString(filter)),
  );

  assert.equal(copied.get("month"), "2026-04");
  assert.equal(copied.get("timePreset"), "custom");
  assert.equal(copied.get("excludePlaid"), "true");
});

test("user-scope predicates include CSV-only hydration and dedupe safeguards", () => {
  assert.equal(
    transactionUserScopePredicate("t"),
    "(t.user_id = @userId OR (@excludePlaid AND t.user_id IS NULL AND t.source_name = 'csv'))",
  );
  assert.equal(
    accountUserScopePredicate("a"),
    "(a.user_id = @userId OR (a.user_id IS NULL AND a.institution = 'csv'))",
  );
  assert.match(
    anonymousCsvDedupePredicate("t"),
    /PARTITION BY t\.canonical_group_id ORDER BY t\.transaction_id/,
  );
  assert.match(
    plaidCanonicalDedupePredicate("t"),
    /PARTITION BY t\.user_id, t\.source_name, t\.canonical_group_id, t\.signed_amount/,
  );
});
