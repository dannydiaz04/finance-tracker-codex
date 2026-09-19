import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  return {
    id: "acct",
    name: "Checking",
    institution: "Capital One",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity keeps the most complete account for a logical duplicate", () => {
  const deduped = dedupeAccountsByLogicalIdentity([
    account({
      id: "csv-checking",
      name: "360 Checking",
      institution: "Capital One",
      mask: "1234",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid-checking",
      name: "360   Checking",
      institution: "capital one",
      mask: "1234",
      currentBalance: 1800,
      availableBalance: 1750,
    }),
    account({
      id: "savings",
      name: "Savings",
      type: "savings",
      mask: "9876",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
  ]);

  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ["plaid-checking", "savings"],
  );
});

test("deriveBalanceTotalsFromAccounts treats credit-card balances as debt and spending capacity separately", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "checking",
      name: "360 Checking",
      currentBalance: 2000,
      availableBalance: 1900,
    }),
    account({
      id: "savings",
      name: "Savings",
      type: "savings",
      mask: "9876",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
    account({
      id: "card",
      name: "Venture Card",
      type: "credit",
      mask: "4242",
      currentBalance: 650,
      availableBalance: 4350,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: 6350,
    availableCash: 6900,
    availableCredit: 4350,
    debtTotal: 650,
    spendingPower: 11250,
  });
});

test("deriveBalanceTotalsFromAccounts scopes by selected account ids before calculating totals", () => {
  const totals = deriveBalanceTotalsFromAccounts(
    [
      account({
        id: "checking",
        currentBalance: 2000,
        availableBalance: 1900,
      }),
      account({
        id: "card",
        name: "Venture Card",
        type: "credit",
        mask: "4242",
        currentBalance: 650,
        availableBalance: 4350,
      }),
    ],
    ["card"],
  );

  assert.deepEqual(totals, {
    totalBalance: -650,
    availableCash: 0,
    availableCredit: 4350,
    debtTotal: 650,
    spendingPower: 4350,
  });
});

test("resolvePrimaryCheckingBalance prefers the Capital One 360 checking account", () => {
  const balance = resolvePrimaryCheckingBalance([
    account({
      id: "legacy-capital-one",
      name: "Essential Checking",
      currentBalance: 200,
      availableBalance: 200,
    }),
    account({
      id: "capital-one-360",
      name: "360 Checking",
      currentBalance: 1850,
      availableBalance: 1800,
    }),
    account({
      id: "other-bank",
      name: "Everyday Checking",
      institution: "Other Bank",
      currentBalance: 900,
      availableBalance: 900,
    }),
  ]);

  assert.deepEqual(balance, {
    accountId: "capital-one-360",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "1234",
    currentBalance: 1850,
    availableBalance: 1800,
  });
});
