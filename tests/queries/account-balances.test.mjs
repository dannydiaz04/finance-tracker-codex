import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolveCapitalOneCheckingAccount,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  return {
    id: "acct_1",
    name: "Everyday Checking",
    institution: "Acme Bank",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 100,
    availableBalance: 90,
    ...overrides,
  };
}

test("logical account dedupe normalizes casing and whitespace, keeping richer account details", () => {
  const duplicateWithSparseBalances = account({
    id: "csv_sparse",
    name: "  Venture   Card ",
    institution: "Capital One",
    type: "credit",
    subtype: "credit card",
    mask: "9876",
    currentBalance: 0,
    availableBalance: 0,
  });
  const richerDuplicate = account({
    id: "plaid_richer",
    name: "venture card",
    institution: " capital   one ",
    type: "credit",
    subtype: "credit card",
    mask: "9876",
    currentBalance: 430.12,
    availableBalance: 1569.88,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    duplicateWithSparseBalances,
    richerDuplicate,
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, "plaid_richer");
  assert.equal(deduped[0].currentBalance, 430.12);
  assert.equal(deduped[0].availableBalance, 1569.88);
});

test("balance totals do not double-count duplicate account rows", () => {
  const accounts = [
    account({
      id: "checking_csv",
      name: "360 Checking",
      institution: "Capital One",
      currentBalance: 2500,
      availableBalance: 2400,
    }),
    account({
      id: "checking_plaid",
      name: "360   checking",
      institution: "capital one",
      currentBalance: 2500,
      availableBalance: 2400,
    }),
    account({
      id: "credit_card",
      name: "Travel Card",
      institution: "Acme Bank",
      type: "credit",
      subtype: "credit card",
      mask: "9999",
      currentBalance: 725,
      availableBalance: 1275,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 1775,
    availableCash: 2400,
    availableCredit: 1275,
    debtTotal: 725,
    spendingPower: 3675,
  });
});

test("selected account totals are scoped before logical dedupe", () => {
  const accounts = [
    account({
      id: "selected_checking",
      name: "360 Checking",
      institution: "Capital One",
      currentBalance: 900,
      availableBalance: 850,
    }),
    account({
      id: "unselected_duplicate",
      name: "360 Checking",
      institution: "Capital One",
      currentBalance: 900,
      availableBalance: 850,
    }),
    account({
      id: "unselected_credit",
      name: "Travel Card",
      institution: "Acme Bank",
      type: "credit",
      subtype: "credit card",
      mask: "9999",
      currentBalance: 400,
      availableBalance: 1600,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, ["selected_checking"]),
    {
      totalBalance: 900,
      availableCash: 850,
      availableCredit: 0,
      debtTotal: 0,
      spendingPower: 850,
    },
  );
});

test("Capital One checking resolution dedupes duplicates and prefers the 360 account", () => {
  const accounts = [
    account({
      id: "legacy_checking",
      name: "Checking",
      institution: "CapitalOne",
      currentBalance: 300,
      availableBalance: 300,
    }),
    account({
      id: "capital_one_sparse",
      name: "360 Checking",
      institution: "Capital One",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "capital_one_live",
      name: "360   checking",
      institution: "capital one",
      currentBalance: 1200,
      availableBalance: 1180,
    }),
  ];

  const resolved = resolveCapitalOneCheckingAccount(accounts);

  assert.equal(resolved?.id, "capital_one_live");
  assert.equal(resolved?.currentBalance, 1200);
});
