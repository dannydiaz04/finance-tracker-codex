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
    name: "Everyday Checking",
    institution: "Capital One",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1111",
    currentBalance: 1000,
    availableBalance: 950,
    ...overrides,
  };
}

test("dedupes logical accounts with normalized institution, name, and mask", () => {
  const duplicateWithLessCompleteMetadata = account({
    id: "csv-checking",
    name: "  Everyday    Checking ",
    institution: " capital one ",
    mask: "1111",
    currentBalance: 0,
    availableBalance: 0,
  });
  const richerPlaidAccount = account({
    id: "plaid-checking",
    name: "Everyday Checking",
    institution: "Capital One",
    mask: "1111",
    currentBalance: 1234.56,
    availableBalance: 1200,
  });
  const savings = account({
    id: "savings",
    name: "Savings",
    type: "savings",
    mask: "2222",
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    duplicateWithLessCompleteMetadata,
    savings,
    richerPlaidAccount,
  ]);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["plaid-checking", "savings"],
  );
});

test("calculates net worth, debt, and spending power without double counting duplicates", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "csv-checking",
      name: "Everyday Checking",
      institution: "Capital One",
      mask: "1111",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid-checking",
      name: "Everyday Checking",
      institution: "Capital One",
      mask: "1111",
      currentBalance: 1000,
      availableBalance: 900,
    }),
    account({
      id: "credit-card",
      name: "Rewards Card",
      institution: "Capital One",
      type: "credit",
      subtype: "credit card",
      mask: "3333",
      currentBalance: 250,
      availableBalance: 4750,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: 750,
    availableCash: 900,
    availableCredit: 4750,
    debtTotal: 250,
    spendingPower: 5650,
  });
});

test("applies selected account scope before logical dedupe", () => {
  const accounts = [
    account({
      id: "older-checking",
      name: "Everyday Checking",
      mask: "1111",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "selected-checking",
      name: "Everyday Checking",
      mask: "1111",
      currentBalance: 800,
      availableBalance: 775,
    }),
    account({
      id: "unselected-savings",
      name: "Savings",
      type: "savings",
      mask: "2222",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
  ];

  const totals = deriveBalanceTotalsFromAccounts(accounts, ["selected-checking"]);

  assert.equal(totals.totalBalance, 800);
  assert.equal(totals.availableCash, 775);
});

test("resolves the Capital One 360 checking balance from deduped accounts", () => {
  const balance = resolvePrimaryCheckingBalance([
    account({
      id: "plain-checking",
      name: "Capital One Checking",
      currentBalance: 400,
      availableBalance: 390,
    }),
    account({
      id: "capital-one-360",
      name: "Capital One 360 Checking",
      currentBalance: 1500,
      availableBalance: 1450,
    }),
    account({
      id: "duplicate-360-csv",
      name: " Capital One   360 Checking ",
      currentBalance: 0,
      availableBalance: 0,
    }),
  ]);

  assert.deepEqual(balance, {
    accountId: "capital-one-360",
    accountName: "Capital One 360 Checking",
    institution: "Capital One",
    mask: "1111",
    currentBalance: 1500,
    availableBalance: 1450,
  });
});
