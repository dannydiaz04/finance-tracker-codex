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
    id: "account_1",
    name: "Everyday Checking",
    institution: "Capital One",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "5980",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupes logical account rows and keeps the richer balance record", () => {
  const accounts = [
    account({
      id: "csv_checking",
      institution: " Capital   One ",
      name: "360 Checking",
    }),
    account({
      id: "plaid_checking",
      institution: "capital one",
      name: "360   Checking",
      currentBalance: 1100,
      availableBalance: 1050,
    }),
    account({
      id: "savings",
      name: "Performance Savings",
      type: "savings",
      mask: "1122",
      currentBalance: 500,
      availableBalance: 450,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["plaid_checking", "savings"],
  );
  assert.equal(deduped[0].currentBalance, 1100);
  assert.equal(deduped[0].availableBalance, 1050);
});

test("balance totals do not double count duplicate cash or credit accounts", () => {
  const accounts = [
    account({
      id: "csv_checking",
      institution: "Capital One",
      name: "360 Checking",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid_checking",
      institution: "capital one",
      name: "360   Checking",
      currentBalance: 1100,
      availableBalance: 1050,
    }),
    account({
      id: "savings",
      name: "Performance Savings",
      type: "savings",
      mask: "1122",
      currentBalance: 500,
      availableBalance: 450,
    }),
    account({
      id: "csv_card",
      institution: "Chase",
      name: "Travel Card",
      type: "credit",
      subtype: "credit card",
      mask: "4242",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid_card",
      institution: " chase ",
      name: "Travel   Card",
      type: "credit",
      subtype: "credit card",
      mask: "4242",
      currentBalance: 300,
      availableBalance: 2700,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 1300,
    availableCash: 1500,
    availableCredit: 2700,
    debtTotal: 300,
    spendingPower: 4200,
  });
});

test("selected account totals are scoped before dedupe and still avoid double counting", () => {
  const accounts = [
    account({
      id: "csv_checking",
      institution: "Capital One",
      name: "360 Checking",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid_checking",
      institution: "capital one",
      name: "360   Checking",
      currentBalance: 1100,
      availableBalance: 1050,
    }),
    account({
      id: "savings",
      name: "Performance Savings",
      type: "savings",
      mask: "1122",
      currentBalance: 500,
      availableBalance: 450,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, ["csv_checking", "plaid_checking"]),
    {
      totalBalance: 1100,
      availableCash: 1050,
      availableCredit: 0,
      debtTotal: 0,
      spendingPower: 1050,
    },
  );
});

test("Capital One primary checking resolution prefers the deduped 360 account", () => {
  const accounts = [
    account({
      id: "everyday",
      name: "Everyday Checking",
      currentBalance: 250,
      availableBalance: 250,
    }),
    account({
      id: "csv_360",
      institution: "CapitalOne",
      name: "360 Checking",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid_360",
      institution: "Capital One",
      name: "360   Checking",
      currentBalance: 875,
      availableBalance: 850,
    }),
  ];

  const accountMatch = resolveCapitalOneCheckingAccount(accounts);
  const balance = resolvePrimaryCheckingBalance(accounts);

  assert.equal(accountMatch?.id, "plaid_360");
  assert.deepEqual(balance, {
    accountId: "plaid_360",
    accountName: "360   Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 875,
    availableBalance: 850,
  });
});
