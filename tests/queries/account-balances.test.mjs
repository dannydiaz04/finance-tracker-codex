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
    id: "acct",
    name: "Checking",
    institution: "Bank",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "0000",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupes logical accounts and keeps the richest account record", () => {
  const accounts = [
    account({
      id: "csv-main",
      name: " Main   Checking ",
      institution: "CAPITAL ONE",
      mask: "5980",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid-main",
      name: "Main Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 8250,
      availableBalance: 8200,
    }),
    account({
      id: "savings",
      name: "Emergency Savings",
      institution: "Capital One",
      type: "savings",
      subtype: "savings",
      mask: "1111",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["savings", "plaid-main"],
  );
  assert.equal(deduped[1].currentBalance, 8250);
  assert.equal(deduped[1].availableBalance, 8200);
});

test("derives cash, credit, debt, and net totals without double-counting duplicates", () => {
  const accounts = [
    account({
      id: "checking-core",
      name: "Main Checking",
      institution: "Schwab",
      currentBalance: 1000,
      availableBalance: 900,
    }),
    account({
      id: "checking-live",
      name: "Main Checking",
      institution: "Schwab",
      currentBalance: 1000,
      availableBalance: 900,
    }),
    account({
      id: "travel-card",
      name: "Travel Card",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "4242",
      currentBalance: 800,
      availableBalance: 4200,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 200,
    availableCash: 900,
    availableCredit: 4200,
    debtTotal: 800,
    spendingPower: 5100,
  });
});

test("applies account-id scope before deduping balance totals", () => {
  const accounts = [
    account({
      id: "selected-checking",
      name: "Main Checking",
      institution: "Schwab",
      currentBalance: 700,
      availableBalance: 650,
    }),
    account({
      id: "unselected-duplicate",
      name: "Main Checking",
      institution: "Schwab",
      currentBalance: 3000,
      availableBalance: 3000,
    }),
    account({
      id: "selected-card",
      name: "Travel Card",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "4242",
      currentBalance: 100,
      availableBalance: 900,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, [
      "selected-checking",
      "selected-card",
    ]),
    {
      totalBalance: 600,
      availableCash: 650,
      availableCredit: 900,
      debtTotal: 100,
      spendingPower: 1550,
    },
  );
});

test("selects the Capital One 360 checking account after logical dedupe", () => {
  const accounts = [
    account({
      id: "capital-one-legacy",
      name: "Everyday Checking",
      institution: "CapitalOne",
      currentBalance: 1200,
      availableBalance: 1200,
    }),
    account({
      id: "capital-one-360-core",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "capital-one-360-live",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 8240.18,
      availableBalance: 8240.18,
    }),
  ];

  const checking = resolveCapitalOneCheckingAccount(accounts);
  const primaryBalance = resolvePrimaryCheckingBalance(accounts);

  assert.equal(checking?.id, "capital-one-360-live");
  assert.deepEqual(primaryBalance, {
    accountId: "capital-one-360-live",
    accountName: "Capital One 360 Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 8240.18,
    availableBalance: 8240.18,
  });
});
