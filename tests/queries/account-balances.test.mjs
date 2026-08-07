import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolveCapitalOneCheckingAccount,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function buildAccount(overrides = {}) {
  return {
    id: "account-1",
    name: "Everyday Checking",
    institution: "Example Bank",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 100,
    availableBalance: 90,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity normalizes logical duplicates and keeps the richer row", () => {
  const accounts = [
    buildAccount({
      id: "csv-checking",
      name: "Everyday   Checking",
      institution: " example bank ",
      mask: "1234",
      currentBalance: 0,
      availableBalance: 0,
    }),
    buildAccount({
      id: "plaid-checking",
      name: "Everyday Checking",
      institution: "Example Bank",
      mask: "1234",
      currentBalance: 1250,
      availableBalance: 1200,
    }),
    buildAccount({
      id: "savings",
      name: "Savings",
      type: "savings",
      mask: "9876",
      currentBalance: 500,
      availableBalance: 500,
    }),
  ];

  assert.deepEqual(
    dedupeAccountsByLogicalIdentity(accounts).map((account) => account.id),
    ["plaid-checking", "savings"],
  );
});

test("deriveBalanceTotalsFromAccounts avoids double counting and treats credit balances as debt", () => {
  const accounts = [
    buildAccount({
      id: "csv-checking",
      name: "Everyday Checking",
      institution: "Example Bank",
      mask: "1234",
      currentBalance: 0,
      availableBalance: 0,
    }),
    buildAccount({
      id: "plaid-checking",
      name: "Everyday Checking",
      institution: "Example Bank",
      mask: "1234",
      currentBalance: 1250,
      availableBalance: 1200,
    }),
    buildAccount({
      id: "travel-card",
      name: "Travel Card",
      institution: "Example Card",
      type: "credit",
      subtype: "credit card",
      mask: "4444",
      currentBalance: 325,
      availableBalance: 4675,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 925,
    availableCash: 1200,
    availableCredit: 4675,
    debtTotal: 325,
    spendingPower: 5875,
  });
});

test("deriveBalanceTotalsFromAccounts scopes before dedupe when account filters are active", () => {
  const accounts = [
    buildAccount({
      id: "csv-checking",
      name: "Everyday Checking",
      institution: "Example Bank",
      mask: "1234",
      currentBalance: 100,
      availableBalance: 100,
    }),
    buildAccount({
      id: "plaid-checking",
      name: "Everyday Checking",
      institution: "Example Bank",
      mask: "1234",
      currentBalance: 1250,
      availableBalance: 1200,
    }),
    buildAccount({
      id: "travel-card",
      name: "Travel Card",
      institution: "Example Card",
      type: "credit",
      subtype: "credit card",
      mask: "4444",
      currentBalance: 325,
      availableBalance: 4675,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts, ["csv-checking"]), {
    totalBalance: 100,
    availableCash: 100,
    availableCredit: 0,
    debtTotal: 0,
    spendingPower: 100,
  });
});

test("Capital One primary checking resolution prefers the 360 checking account", () => {
  const accounts = [
    buildAccount({
      id: "capital-one-legacy",
      name: "Performance Checking",
      institution: "CapitalOne",
      mask: "1111",
      currentBalance: 600,
      availableBalance: 575,
    }),
    buildAccount({
      id: "capital-one-360",
      name: "360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1488.25,
      availableBalance: 1488.25,
    }),
    buildAccount({
      id: "capital-one-card",
      name: "Venture Card",
      institution: "Capital One",
      type: "credit",
      subtype: "credit card",
      mask: "2222",
      currentBalance: 100,
      availableBalance: 4900,
    }),
  ];

  assert.equal(resolveCapitalOneCheckingAccount(accounts)?.id, "capital-one-360");
  assert.deepEqual(resolvePrimaryCheckingBalance(accounts), {
    accountId: "capital-one-360",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 1488.25,
    availableBalance: 1488.25,
  });
});
