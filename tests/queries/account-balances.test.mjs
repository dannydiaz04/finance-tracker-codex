import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  return {
    id: "account-1",
    name: "Capital One 360 Checking",
    institution: "Capital One",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "5980",
    currentBalance: 1000,
    availableBalance: 950,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity collapses equivalent accounts and keeps the richer row", () => {
  const accounts = [
    account({
      id: "sparse",
      name: "  Capital One   360 Checking ",
      institution: "CAPITAL ONE",
      mask: "5980",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "rich",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1234.56,
      availableBalance: 1200,
    }),
    account({
      id: "savings",
      name: "Emergency Savings",
      type: "savings",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ["rich", "savings"],
  );
  assert.equal(deduped[0].currentBalance, 1234.56);
  assert.equal(deduped[0].availableBalance, 1200);
});

test("deriveBalanceTotalsFromAccounts does not double count duplicate logical accounts", () => {
  const accounts = [
    account({
      id: "checking-old",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "checking-new",
      currentBalance: 1200,
      availableBalance: 1150,
    }),
    account({
      id: "travel-card",
      name: "Travel Rewards Card",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "4242",
      currentBalance: 300,
      availableBalance: 4700,
    }),
  ];

  const totals = deriveBalanceTotalsFromAccounts(accounts);

  assert.deepEqual(totals, {
    totalBalance: 900,
    availableCash: 1150,
    availableCredit: 4700,
    debtTotal: 300,
    spendingPower: 5850,
  });
});

test("deriveBalanceTotalsFromAccounts applies selected account scope before dedupe", () => {
  const accounts = [
    account({
      id: "checking-old",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "checking-new",
      currentBalance: 1200,
      availableBalance: 1150,
    }),
    account({
      id: "travel-card",
      name: "Travel Rewards Card",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "4242",
      currentBalance: 300,
      availableBalance: 4700,
    }),
  ];

  const totals = deriveBalanceTotalsFromAccounts(accounts, [
    "checking-old",
    "checking-new",
  ]);

  assert.deepEqual(totals, {
    totalBalance: 1200,
    availableCash: 1150,
    availableCredit: 0,
    debtTotal: 0,
    spendingPower: 1150,
  });
});

test("resolvePrimaryCheckingBalance dedupes Capital One checking before choosing the live balance", () => {
  const balance = resolvePrimaryCheckingBalance([
    account({
      id: "csv-shadow",
      institution: " capital one ",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid-live",
      institution: "Capital One",
      currentBalance: 2345.67,
      availableBalance: 2300,
    }),
  ]);

  assert.ok(balance);
  assert.equal(balance.accountId, "plaid-live");
  assert.equal(balance.accountName, "Capital One 360 Checking");
  assert.equal(balance.currentBalance, 2345.67);
  assert.equal(balance.availableBalance, 2300);
});
