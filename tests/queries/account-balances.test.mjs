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
    id: "account-1",
    name: "Rewards Checking",
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

test("dedupes logical duplicate accounts and keeps the richer balance row", () => {
  const duplicateFromCsv = account({
    id: "csv-checking",
    institution: " capital   one ",
    name: " rewards   checking ",
    currentBalance: 1250,
    availableBalance: 0,
  });
  const richerPlaidRow = account({
    id: "plaid-checking",
    institution: "Capital One",
    name: "Rewards Checking",
    currentBalance: 1250,
    availableBalance: 1200,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    duplicateFromCsv,
    richerPlaidRow,
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, "plaid-checking");
});

test("derives net worth and spending power after account dedupe", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "csv-checking",
      currentBalance: 1250,
      availableBalance: 0,
    }),
    account({
      id: "plaid-checking",
      currentBalance: 1250,
      availableBalance: 1200,
    }),
    account({
      id: "savings",
      name: "Savings",
      type: "savings",
      subtype: "savings",
      mask: "9876",
      currentBalance: 300,
      availableBalance: 280,
    }),
    account({
      id: "credit-card",
      name: "Venture Card",
      type: "credit",
      subtype: "credit card",
      mask: "5555",
      currentBalance: 400,
      availableBalance: 1600,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: 1150,
    availableCash: 1480,
    availableCredit: 1600,
    debtTotal: 400,
    spendingPower: 3080,
  });
});

test("scopes selected account totals before logical dedupe", () => {
  const totals = deriveBalanceTotalsFromAccounts(
    [
      account({
        id: "csv-checking",
        currentBalance: 1250,
        availableBalance: 0,
      }),
      account({
        id: "plaid-checking",
        currentBalance: 1250,
        availableBalance: 1200,
      }),
      account({
        id: "credit-card",
        name: "Venture Card",
        type: "credit",
        subtype: "credit card",
        mask: "5555",
        currentBalance: 400,
        availableBalance: 1600,
      }),
    ],
    ["csv-checking", "credit-card"],
  );

  assert.deepEqual(totals, {
    totalBalance: 850,
    availableCash: 0,
    availableCredit: 1600,
    debtTotal: 400,
    spendingPower: 1600,
  });
});

test("resolves Capital One 360 checking when multiple checking accounts exist", () => {
  const accountMatch = resolveCapitalOneCheckingAccount([
    account({
      id: "branch-checking",
      name: "Everyday Checking",
      mask: "1111",
      currentBalance: 600,
      availableBalance: 550,
    }),
    account({
      id: "capital-one-360",
      name: "360 Checking",
      mask: "2222",
      currentBalance: 2400,
      availableBalance: 2350,
    }),
  ]);

  assert.equal(accountMatch?.id, "capital-one-360");
});

test("primary checking balance exposes live current and available balances", () => {
  const balance = resolvePrimaryCheckingBalance([
    account({
      id: "capital-one-360",
      name: "360 Checking",
      mask: "2222",
      currentBalance: 2400,
      availableBalance: 2350,
    }),
  ]);

  assert.deepEqual(balance, {
    accountId: "capital-one-360",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "2222",
    currentBalance: 2400,
    availableBalance: 2350,
  });
});
