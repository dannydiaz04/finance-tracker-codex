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
    id: "acc-1",
    name: "Everyday Checking",
    institution: "Capital One",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 100,
    availableBalance: 90,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity collapses formatted duplicates and keeps the richer row", () => {
  const duplicateShell = account({
    id: "csv-shadow",
    name: "  venture   card  ",
    institution: " CAPITAL   ONE ",
    type: "credit",
    subtype: "credit card",
    mask: "0099",
    currentBalance: 0,
    availableBalance: 0,
  });
  const richerPlaidRow = account({
    id: "plaid-live",
    name: "Venture Card",
    institution: "Capital One",
    type: "credit",
    subtype: "credit card",
    mask: "0099",
    currentBalance: 250,
    availableBalance: 1750,
  });
  const savings = account({
    id: "savings",
    name: "Performance Savings",
    type: "savings",
    mask: "1111",
    currentBalance: 1200,
    availableBalance: 1200,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    duplicateShell,
    savings,
    richerPlaidRow,
  ]);

  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ["savings", "plaid-live"],
  );
});

test("deriveBalanceTotalsFromAccounts dedupes before summing debt and spending power", () => {
  const accounts = [
    account({
      id: "checking",
      name: "360 Checking",
      currentBalance: 800,
      availableBalance: 750,
    }),
    account({
      id: "card-shadow",
      name: "Venture Card",
      type: "credit",
      subtype: "credit card",
      mask: "0099",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "card-live",
      name: "Venture Card",
      type: "credit",
      subtype: "credit card",
      mask: "0099",
      currentBalance: 250,
      availableBalance: 1750,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 550,
    availableCash: 750,
    availableCredit: 1750,
    debtTotal: 250,
    spendingPower: 2500,
  });
});

test("deriveBalanceTotalsFromAccounts scopes by selected ids before logical dedupe", () => {
  const accounts = [
    account({
      id: "checking-filtered",
      name: "360 Checking",
      currentBalance: 800,
      availableBalance: 750,
    }),
    account({
      id: "checking-selected",
      name: "360 Checking",
      currentBalance: 700,
      availableBalance: 650,
    }),
    account({
      id: "card-selected",
      name: "Venture Card",
      type: "credit",
      subtype: "credit card",
      mask: "0099",
      currentBalance: 150,
      availableBalance: 1850,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, [
      "checking-selected",
      "card-selected",
    ]),
    {
      totalBalance: 550,
      availableCash: 650,
      availableCredit: 1850,
      debtTotal: 150,
      spendingPower: 2500,
    },
  );
});

test("resolveCapitalOneCheckingAccount dedupes accounts and prefers the 360 checking account", () => {
  const accounts = [
    account({
      id: "other-checking",
      name: "Everyday Checking",
      currentBalance: 100,
      availableBalance: 100,
    }),
    account({
      id: "shadow-360",
      name: "360 Checking",
      currentBalance: 0,
      availableBalance: 0,
      mask: "5980",
    }),
    account({
      id: "live-360",
      name: "360 Checking",
      currentBalance: 1425.55,
      availableBalance: 1400.55,
      mask: "5980",
    }),
  ];

  const resolved = resolveCapitalOneCheckingAccount(accounts);

  assert.equal(resolved?.id, "live-360");
  assert.deepEqual(resolvePrimaryCheckingBalance(accounts), {
    accountId: "live-360",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 1425.55,
    availableBalance: 1400.55,
  });
});
