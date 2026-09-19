import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolveCapitalOneCheckingAccount,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";
import {
  accountUserScopePredicate,
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
import {
  buildTransactionQueryParams,
  normalizeTransactionFilters,
  scopeToTransactionFilters,
} from "../../lib/bigquery/params.ts";

function account(overrides = {}) {
  return {
    id: "acct_1",
    name: "Everyday Checking",
    institution: "Acme Bank",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 1000,
    availableBalance: 900,
    ...overrides,
  };
}

test("transaction scope includes anonymous CSV rows only in exclude-Plaid mode", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
  assert.equal(
    transactionUserScopePredicate("current_txn"),
    "(current_txn.user_id = @userId OR (@excludePlaid AND current_txn.user_id IS NULL AND current_txn.source_name = 'csv'))",
  );
});

test("query predicates preserve CSV hydration and dedupe semantics", () => {
  assert.equal(
    accountUserScopePredicate("account"),
    "(account.user_id = @userId OR (account.user_id IS NULL AND account.institution = 'csv'))",
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

test("time filter parsing and serialization preserve the dashboard exclude-Plaid scope", () => {
  const fromBooleanParam = normalizeTimeFilter({
    from: "2026-04-01",
    to: "2026-04-30",
    timePreset: "all",
    excludePlaid: "true",
  });
  assert.deepEqual(fromBooleanParam, {
    from: "2026-04-01",
    to: "2026-04-30",
    month: undefined,
    preset: "custom",
    excludePlaid: true,
  });
  assert.deepEqual(buildTimeFilterQueryParams(fromBooleanParam), {
    from: "2026-04-01",
    to: "2026-04-30",
    excludePlaid: true,
  });

  const fromNumericParam = normalizeTimeFilter({
    month: "2026-02",
    excludePlaid: "1",
  });
  assert.equal(fromNumericParam.from, "2026-02-01");
  assert.equal(fromNumericParam.to, "2026-02-28");
  assert.equal(fromNumericParam.preset, "custom");
  assert.equal(fromNumericParam.excludePlaid, true);

  const serialized = new URLSearchParams(
    timeFilterToSearchString({
      preset: "last90",
      from: "2026-01-01",
      to: "2026-03-31",
      excludePlaid: true,
    }),
  );
  assert.equal(serialized.get("timePreset"), "last90");
  assert.equal(serialized.get("from"), "2026-01-01");
  assert.equal(serialized.get("to"), "2026-03-31");
  assert.equal(serialized.get("excludePlaid"), "true");
});

test("copyTimeFilterParams carries only dashboard scope keys", () => {
  const source = new URLSearchParams({
    from: "2026-05-01",
    to: "2026-05-31",
    timePreset: "custom",
    month: "2026-05",
    excludePlaid: "true",
    selectedId: "txn_123",
    query: "coffee",
  });
  const target = copyTimeFilterParams(source);

  assert.deepEqual([...target.entries()], [
    ["from", "2026-05-01"],
    ["to", "2026-05-31"],
    ["timePreset", "custom"],
    ["month", "2026-05"],
    ["excludePlaid", "true"],
  ]);
  assert.equal(target.has("selectedId"), false);
  assert.equal(target.has("query"), false);
});

test("transaction search params normalize and pass exclude-Plaid through BigQuery params", () => {
  const filters = normalizeTransactionFilters({
    query: "  coffee  ",
    accountIds: "checking, savings",
    categoryIds: ["food", "travel"],
    minAmount: "10.5",
    maxAmount: "not-a-number",
    excludePlaid: "1",
  });

  assert.deepEqual(filters, {
    query: "coffee",
    accountIds: ["checking", "savings"],
    categoryIds: ["food", "travel"],
    merchant: undefined,
    direction: "all",
    transactionClass: "all",
    pending: "all",
    from: undefined,
    to: undefined,
    minAmount: 10.5,
    maxAmount: undefined,
    selectedId: undefined,
    excludePlaid: true,
  });

  assert.deepEqual(scopeToTransactionFilters({ preset: "all", excludePlaid: true }), {
    from: undefined,
    to: undefined,
    excludePlaid: true,
  });
  assert.deepEqual(buildTransactionQueryParams(filters), {
    query: "coffee",
    accountIds: ["checking", "savings"],
    hasAccountIds: true,
    categoryIds: ["food", "travel"],
    hasCategoryIds: true,
    merchant: "",
    direction: "",
    transactionClass: "",
    pending: "",
    from: "",
    to: "",
    minAmount: 10.5,
    maxAmount: -1,
    excludePlaid: true,
  });
});

test("empty transaction filters use safe sentinel BigQuery params", () => {
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

test("logical account dedupe keeps the richest row and prevents balance double-counting", () => {
  const duplicateCsvStub = account({
    id: "csv_stub",
    institution: "  capital one  ",
    name: "Capital One 360 Checking",
    mask: "5980",
    currentBalance: 0,
    availableBalance: 0,
  });
  const duplicatePlaidBalance = account({
    id: "plaid_live",
    institution: "Capital One",
    name: "Capital   One 360 Checking",
    mask: "5980",
    currentBalance: 1250,
    availableBalance: 1200,
  });
  const savings = account({
    id: "savings",
    name: "Emergency Savings",
    type: "savings",
    currentBalance: 3000,
    availableBalance: 3000,
  });
  const travelCard = account({
    id: "travel_card",
    name: "Travel Card",
    type: "credit",
    currentBalance: 450,
    availableBalance: 5550,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    duplicateCsvStub,
    savings,
    travelCard,
    duplicatePlaidBalance,
  ]);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["plaid_live", "savings", "travel_card"],
  );
  assert.deepEqual(
    deriveBalanceTotalsFromAccounts([
      duplicateCsvStub,
      savings,
      travelCard,
      duplicatePlaidBalance,
    ]),
    {
      totalBalance: 3800,
      availableCash: 4200,
      availableCredit: 5550,
      debtTotal: 450,
      spendingPower: 9750,
    },
  );
});

test("selected account totals are scoped before account dedupe", () => {
  const duplicateCsvStub = account({
    id: "csv_stub",
    institution: "Capital One",
    name: "Capital One 360 Checking",
    mask: "5980",
    currentBalance: 0,
    availableBalance: 0,
  });
  const duplicatePlaidBalance = account({
    id: "plaid_live",
    institution: "Capital One",
    name: "Capital One 360 Checking",
    mask: "5980",
    currentBalance: 1250,
    availableBalance: 1200,
  });

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(
      [duplicateCsvStub, duplicatePlaidBalance],
      ["csv_stub"],
    ),
    {
      totalBalance: 0,
      availableCash: 0,
      availableCredit: 0,
      debtTotal: 0,
      spendingPower: 0,
    },
  );
});

test("Capital One checking resolution dedupes and prefers the 360 account", () => {
  const genericCapitalOneChecking = account({
    id: "generic_checking",
    institution: "CapitalOne",
    name: "Everyday Checking",
    mask: "1000",
    currentBalance: 500,
    availableBalance: 500,
  });
  const capitalOne360 = account({
    id: "capital_one_360",
    institution: "Capital One",
    name: "Capital One 360 Checking",
    mask: "5980",
    currentBalance: 1250,
    availableBalance: 1200,
  });
  const duplicateStub = account({
    id: "csv_stub",
    institution: "capital one",
    name: "Capital One 360 Checking",
    mask: "5980",
    currentBalance: 0,
    availableBalance: 0,
  });

  assert.equal(
    resolveCapitalOneCheckingAccount([
      genericCapitalOneChecking,
      duplicateStub,
      capitalOne360,
    ])?.id,
    "capital_one_360",
  );
  assert.deepEqual(
    resolvePrimaryCheckingBalance([genericCapitalOneChecking, duplicateStub, capitalOne360]),
    {
      accountId: "capital_one_360",
      accountName: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1250,
      availableBalance: 1200,
    },
  );
});
