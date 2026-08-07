import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveBalanceTotalsFromAccounts,
  resolveCapitalOneCheckingAccount,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides) {
  return {
    id: "acct-1",
    name: "Account",
    institution: "Bank",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("deriveBalanceTotalsFromAccounts treats credit cards as debt and spending power as cash plus available credit", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "checking",
      name: "Checking",
      currentBalance: 1200,
      availableBalance: 1100,
    }),
    account({
      id: "savings",
      name: "Savings",
      type: "savings",
      currentBalance: 800,
      availableBalance: 800,
    }),
    account({
      id: "credit-card",
      name: "Rewards Card",
      type: "credit",
      subtype: "credit card",
      currentBalance: 300,
      availableBalance: 1700,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: 1700,
    availableCash: 1900,
    availableCredit: 1700,
    debtTotal: 300,
    spendingPower: 3600,
  });
});

test("deriveBalanceTotalsFromAccounts scopes all balance totals to selected account ids", () => {
  const totals = deriveBalanceTotalsFromAccounts(
    [
      account({
        id: "checking",
        name: "Checking",
        currentBalance: 1200,
        availableBalance: 1100,
      }),
      account({
        id: "savings",
        name: "Savings",
        type: "savings",
        currentBalance: 800,
        availableBalance: 800,
      }),
      account({
        id: "credit-card",
        name: "Rewards Card",
        type: "credit",
        subtype: "credit card",
        currentBalance: 300,
        availableBalance: 1700,
      }),
    ],
    ["checking", "credit-card"],
  );

  assert.deepEqual(totals, {
    totalBalance: 900,
    availableCash: 1100,
    availableCredit: 1700,
    debtTotal: 300,
    spendingPower: 2800,
  });
});

test("deriveBalanceTotalsFromAccounts handles credit-only views as negative net worth", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "credit-card",
      name: "Rewards Card",
      type: "credit",
      subtype: "credit card",
      currentBalance: 450,
      availableBalance: 1550,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: -450,
    availableCash: 0,
    availableCredit: 1550,
    debtTotal: 450,
    spendingPower: 1550,
  });
});

test("deriveBalanceTotalsFromAccounts falls back to current balance when cash available balance is missing", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "checking",
      name: "Checking",
      currentBalance: 1200,
      availableBalance: undefined,
    }),
  ]);

  assert.equal(totals.availableCash, 1200);
  assert.equal(totals.spendingPower, 1200);
});

test("resolveCapitalOneCheckingAccount prefers a 360 checking account when multiple matches exist", () => {
  const fallbackChecking = account({
    id: "cap-one-checking",
    name: "Essential Checking",
    institution: "CapitalOne",
    currentBalance: 500,
    availableBalance: 500,
  });
  const primaryChecking = account({
    id: "cap-one-360",
    name: "360 Checking",
    institution: "Capital One",
    currentBalance: 1250,
    availableBalance: 1200,
    mask: "6789",
  });

  assert.equal(
    resolveCapitalOneCheckingAccount([fallbackChecking, primaryChecking]),
    primaryChecking,
  );
  assert.deepEqual(resolvePrimaryCheckingBalance([fallbackChecking, primaryChecking]), {
    accountId: "cap-one-360",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "6789",
    currentBalance: 1250,
    availableBalance: 1200,
  });
});
