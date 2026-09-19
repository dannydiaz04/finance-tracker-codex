import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  return {
    id: "acct-1",
    name: "Capital One 360 Checking",
    institution: "Capital One",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "5980",
    currentBalance: 1200,
    availableBalance: 1100,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity collapses normalized duplicates and keeps richer balance data", () => {
  const accounts = [
    account({
      id: "generic",
      name: "  capital   one 360 checking ",
      institution: " CAPITAL ONE ",
      mask: "5980",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "richer",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 2500,
      availableBalance: 2400,
    }),
    account({
      id: "savings",
      name: "Savings",
      type: "savings",
      mask: "1111",
      currentBalance: 500,
      availableBalance: 500,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["richer", "savings"],
  );
});

test("deriveBalanceTotalsFromAccounts dedupes before calculating cash, credit, debt, and spending power", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "checking-stale",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "checking-current",
      currentBalance: 1000,
      availableBalance: 900,
    }),
    account({
      id: "credit-stale",
      name: "Rewards Card",
      type: "credit",
      mask: "4444",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "credit-current",
      name: "Rewards Card",
      type: "credit",
      mask: "4444",
      currentBalance: 250,
      availableBalance: 1750,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: 750,
    availableCash: 900,
    availableCredit: 1750,
    debtTotal: 250,
    spendingPower: 2650,
  });
});

test("deriveBalanceTotalsFromAccounts scopes by selected account ids before deduping", () => {
  const accounts = [
    account({
      id: "checking-stale",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "checking-current",
      currentBalance: 1000,
      availableBalance: 900,
    }),
    account({
      id: "credit-current",
      name: "Rewards Card",
      type: "credit",
      mask: "4444",
      currentBalance: 250,
      availableBalance: 1750,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, ["checking-stale", "checking-current"]),
    {
      totalBalance: 1000,
      availableCash: 900,
      availableCredit: 0,
      debtTotal: 0,
      spendingPower: 900,
    },
  );
});

test("resolvePrimaryCheckingBalance dedupes Capital One accounts and prefers the 360 checking account", () => {
  const primary = resolvePrimaryCheckingBalance([
    account({
      id: "legacy-duplicate",
      name: "Capital One 360 Checking",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "other-capital-one-checking",
      name: "Everyday Checking",
      mask: "2222",
      currentBalance: 900,
      availableBalance: 850,
    }),
    account({
      id: "live-360",
      name: "Capital One 360 Checking",
      currentBalance: 2200,
      availableBalance: 2100,
    }),
  ]);

  assert.deepEqual(primary, {
    accountId: "live-360",
    accountName: "Capital One 360 Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 2200,
    availableBalance: 2100,
  });
});
