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
    mask: "1234",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupes logical account rows and keeps the richest balance record", () => {
  const sparseChecking = account({
    id: "dim_checking",
    name: "  Everyday   Checking ",
    institution: "CAPITAL ONE",
    currentBalance: 0,
    availableBalance: 0,
  });
  const liveChecking = account({
    id: "metadata_checking",
    name: "everyday checking",
    institution: "Capital One",
    currentBalance: 1250,
    availableBalance: 1200,
  });
  const savings = account({
    id: "savings",
    name: "Performance Savings",
    type: "savings",
    mask: "5678",
    currentBalance: 5000,
    availableBalance: 5000,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    sparseChecking,
    savings,
    liveChecking,
  ]);

  assert.deepEqual(
    deduped.map((row) => row.id),
    ["metadata_checking", "savings"],
  );
  assert.equal(deduped[0].currentBalance, 1250);
  assert.equal(deduped[0].availableBalance, 1200);
});

test("balance totals do not double count duplicate cash or credit accounts", () => {
  const accounts = [
    account({
      id: "checking_dim",
      name: "Everyday Checking",
      currentBalance: 100,
      availableBalance: 90,
    }),
    account({
      id: "checking_live",
      name: "everyday   checking",
      currentBalance: 125,
      availableBalance: 120,
    }),
    account({
      id: "credit_dim",
      name: "Venture Card",
      type: "credit",
      mask: "9999",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "credit_live",
      name: "venture card",
      type: "credit",
      mask: "9999",
      currentBalance: 50,
      availableBalance: 450,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 75,
    availableCash: 120,
    availableCredit: 450,
    debtTotal: 50,
    spendingPower: 570,
  });
});

test("selected account totals are scoped before logical dedupe", () => {
  const accounts = [
    account({
      id: "selected_snapshot",
      name: "Everyday Checking",
      currentBalance: 100,
      availableBalance: 90,
    }),
    account({
      id: "unselected_live",
      name: "everyday checking",
      currentBalance: 125,
      availableBalance: 120,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts, ["selected_snapshot"]), {
    totalBalance: 100,
    availableCash: 90,
    availableCredit: 0,
    debtTotal: 0,
    spendingPower: 90,
  });
});

test("Capital One primary checking ignores duplicates and prefers 360 checking", () => {
  const duplicateChecking = account({
    id: "duplicate",
    name: "Everyday Checking",
    institution: "CapitalOne",
    currentBalance: 20,
    availableBalance: 20,
  });
  const richerDuplicate = account({
    id: "richer_duplicate",
    name: "everyday checking",
    institution: "Capital One",
    currentBalance: 30,
    availableBalance: 30,
  });
  const checking360 = account({
    id: "checking_360",
    name: "360 Checking",
    institution: "Capital One",
    currentBalance: 700,
    availableBalance: 650,
  });
  const nonCapitalOne = account({
    id: "external",
    name: "360 Checking",
    institution: "Other Bank",
    currentBalance: 999,
    availableBalance: 999,
  });

  const match = resolveCapitalOneCheckingAccount([
    duplicateChecking,
    richerDuplicate,
    nonCapitalOne,
    checking360,
  ]);

  assert.equal(match?.id, "checking_360");
  assert.deepEqual(resolvePrimaryCheckingBalance([checking360]), {
    accountId: "checking_360",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "1234",
    currentBalance: 700,
    availableBalance: 650,
  });
});
