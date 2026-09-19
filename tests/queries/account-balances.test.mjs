import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  return {
    id: "acc_checking",
    name: "Everyday Checking",
    institution: "Acme Bank",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupes logical accounts and keeps the richer balance record", () => {
  const accounts = [
    account({
      id: "csv_checking",
      name: "Everyday   Checking",
      institution: "ACME Bank",
      mask: "1234",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid_checking",
      name: "Everyday Checking",
      institution: "Acme Bank",
      mask: "1234",
      currentBalance: 1240,
      availableBalance: 1200,
    }),
    account({
      id: "savings",
      name: "Reserve Savings",
      type: "savings",
      currentBalance: 300,
      availableBalance: 300,
      mask: "9876",
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ["plaid_checking", "savings"],
  );
});

test("computes net worth, available cash, credit, debt, and spending power without double counting duplicates", () => {
  const accounts = [
    account({
      id: "checking",
      currentBalance: 1200,
      availableBalance: 1100,
    }),
    account({
      id: "checking_duplicate",
      currentBalance: 10,
      availableBalance: 10,
    }),
    account({
      id: "rewards_card",
      name: "Rewards Card",
      institution: "Acme Bank",
      type: "credit",
      subtype: "credit card",
      mask: "4444",
      currentBalance: 350,
      availableBalance: 1650,
    }),
    account({
      id: "rewards_card_duplicate",
      name: "Rewards Card",
      institution: "ACME BANK",
      type: "credit",
      subtype: "credit card",
      mask: "4444",
      currentBalance: 999,
      availableBalance: 1,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 850,
    availableCash: 1100,
    availableCredit: 1650,
    debtTotal: 350,
    spendingPower: 2750,
  });
});

test("scopes balance totals before deduping when account filters are active", () => {
  const accounts = [
    account({
      id: "selected_checking",
      currentBalance: 500,
      availableBalance: 450,
    }),
    account({
      id: "unselected_checking_duplicate",
      currentBalance: 900,
      availableBalance: 850,
    }),
    account({
      id: "selected_card",
      name: "Rewards Card",
      type: "credit",
      subtype: "credit card",
      mask: "4444",
      currentBalance: 125,
      availableBalance: 1875,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, [
      "selected_checking",
      "selected_card",
    ]),
    {
      totalBalance: 375,
      availableCash: 450,
      availableCredit: 1875,
      debtTotal: 125,
      spendingPower: 2325,
    },
  );
});

test("resolves the Capital One 360 checking account as the primary checking balance", () => {
  const balance = resolvePrimaryCheckingBalance([
    account({
      id: "capital_one_basic",
      name: "Essential Checking",
      institution: "Capital One",
      mask: "1111",
      currentBalance: 250,
      availableBalance: 240,
    }),
    account({
      id: "capital_one_360",
      name: "360 Checking",
      institution: "CapitalOne",
      mask: "2222",
      currentBalance: 1750,
      availableBalance: 1700,
    }),
    account({
      id: "other_checking",
      name: "360 Checking",
      institution: "Other Bank",
      mask: "3333",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
  ]);

  assert.deepEqual(balance, {
    accountId: "capital_one_360",
    accountName: "360 Checking",
    institution: "CapitalOne",
    mask: "2222",
    currentBalance: 1750,
    availableBalance: 1700,
  });
});

test("returns null when no Capital One checking account is linked", () => {
  assert.equal(
    resolvePrimaryCheckingBalance([
      account({ id: "savings", type: "savings", subtype: "savings" }),
    ]),
    null,
  );
});
