import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolveCapitalOneCheckingAccount,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  return {
    id: "account-1",
    name: "Checking",
    institution: "Capital One",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 1000,
    availableBalance: 950,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity collapses normalized duplicates and keeps the richer row", () => {
  const sparseDuplicate = account({
    id: "placeholder-1",
    name: "  Capital   One 360 Checking ",
    institution: " capital one ",
    mask: "1234",
    currentBalance: 0,
    availableBalance: 0,
  });
  const richerDuplicate = account({
    id: "plaid-1",
    name: "Capital One 360 Checking",
    institution: "Capital One",
    mask: "1234",
    currentBalance: 1250,
    availableBalance: 1200,
  });
  const savings = account({
    id: "savings-1",
    name: "Emergency Savings",
    type: "savings",
    subtype: "savings",
    mask: "9999",
    currentBalance: 5000,
    availableBalance: 5000,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    sparseDuplicate,
    savings,
    richerDuplicate,
  ]);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["plaid-1", "savings-1"],
  );
});

test("deriveBalanceTotalsFromAccounts does not double count logical duplicates", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "csv-checking",
      name: "Capital One 360 Checking",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid-checking",
      name: "Capital One 360 Checking",
      currentBalance: 1200,
      availableBalance: 1150,
    }),
    account({
      id: "travel-card",
      name: "Travel Rewards",
      type: "credit",
      subtype: "credit card",
      mask: "7777",
      currentBalance: 300,
      availableBalance: 1700,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: 900,
    availableCash: 1150,
    availableCredit: 1700,
    debtTotal: 300,
    spendingPower: 2850,
  });
});

test("deriveBalanceTotalsFromAccounts scopes selected account ids before deduping", () => {
  const totals = deriveBalanceTotalsFromAccounts(
    [
      account({
        id: "selected-csv-row",
        name: "Capital One 360 Checking",
        currentBalance: 0,
        availableBalance: 0,
      }),
      account({
        id: "unselected-plaid-row",
        name: "Capital One 360 Checking",
        currentBalance: 1200,
        availableBalance: 1150,
      }),
    ],
    ["selected-csv-row"],
  );

  assert.deepEqual(totals, {
    totalBalance: 0,
    availableCash: 0,
    availableCredit: 0,
    debtTotal: 0,
    spendingPower: 0,
  });
});

test("resolveCapitalOneCheckingAccount dedupes candidates and prefers the 360 checking account", () => {
  const selected = resolveCapitalOneCheckingAccount([
    account({
      id: "capital-one-basic",
      name: "Everyday Checking",
      mask: "1111",
      currentBalance: 400,
      availableBalance: 400,
    }),
    account({
      id: "capital-one-360-sparse",
      name: "Capital One 360 Checking",
      mask: "2222",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "capital-one-360-rich",
      name: "Capital One 360 Checking",
      mask: "2222",
      currentBalance: 1400,
      availableBalance: 1375,
    }),
    account({
      id: "other-bank",
      institution: "Local Credit Union",
      name: "360 Checking",
      mask: "3333",
      currentBalance: 900,
      availableBalance: 900,
    }),
  ]);

  assert.equal(selected?.id, "capital-one-360-rich");
});

test("resolvePrimaryCheckingBalance exposes the resolved Capital One live balance", () => {
  const balance = resolvePrimaryCheckingBalance([
    account({
      id: "capitalone-primary",
      institution: "capitalone",
      name: "360 Performance Checking",
      currentBalance: 2500,
      availableBalance: 2450,
    }),
  ]);

  assert.deepEqual(balance, {
    accountId: "capitalone-primary",
    accountName: "360 Performance Checking",
    institution: "capitalone",
    mask: "1234",
    currentBalance: 2500,
    availableBalance: 2450,
  });
});
