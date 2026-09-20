import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  return {
    id: "account-id",
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

test("dedupes logical account rows and keeps the richer record", () => {
  const sparseDuplicate = account({
    id: "raw-capital-one",
    name: "Capital One 360 Checking",
    institution: "capital one",
    mask: "1111",
    currentBalance: 0,
    availableBalance: 0,
  });
  const richerDuplicate = account({
    id: "plaid-capital-one",
    name: " capital   one 360 checking ",
    institution: "Capital One",
    mask: "1111",
    currentBalance: 1200,
    availableBalance: 1150,
  });
  const savings = account({
    id: "savings",
    name: "Savings",
    type: "savings",
    mask: "2222",
    currentBalance: 500,
    availableBalance: 500,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    savings,
    sparseDuplicate,
    richerDuplicate,
  ]);

  assert.equal(deduped.length, 2);
  assert.equal(
    deduped.find((item) => item.mask === "1111").id,
    "plaid-capital-one",
  );
  assert.deepEqual(
    deduped.map((item) => item.name),
    [" capital   one 360 checking ", "Savings"],
  );
});

test("derives balance totals without double-counting duplicate account rows", () => {
  const accounts = [
    account({
      id: "checking-sparse",
      name: "Capital One 360 Checking",
      mask: "1111",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "checking-rich",
      name: "capital one 360 checking",
      mask: "1111",
      currentBalance: 1000,
      availableBalance: 950,
    }),
    account({
      id: "savings",
      name: "Savings",
      type: "savings",
      mask: "2222",
      currentBalance: 250,
      availableBalance: 240,
    }),
    account({
      id: "credit-card",
      name: "Travel Card",
      type: "credit",
      mask: "3333",
      currentBalance: 400,
      availableBalance: 1600,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 850,
    availableCash: 1190,
    availableCredit: 1600,
    debtTotal: 400,
    spendingPower: 2790,
  });
});

test("scopes balances before dedupe so selected accounts cannot leak totals", () => {
  const duplicateNotSelected = account({
    id: "checking-rich",
    name: "Capital One 360 Checking",
    mask: "1111",
    currentBalance: 1000,
    availableBalance: 950,
  });
  const selectedSparse = account({
    id: "checking-sparse",
    name: "capital one 360 checking",
    mask: "1111",
    currentBalance: 100,
    availableBalance: 80,
  });
  const selectedCredit = account({
    id: "credit-card",
    name: "Travel Card",
    type: "credit",
    mask: "3333",
    currentBalance: 50,
    availableBalance: 200,
  });

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(
      [duplicateNotSelected, selectedSparse, selectedCredit],
      ["checking-sparse", "credit-card"],
    ),
    {
      totalBalance: 50,
      availableCash: 80,
      availableCredit: 200,
      debtTotal: 50,
      spendingPower: 280,
    },
  );
});

test("resolves Capital One 360 checking as the primary live checking balance", () => {
  const primary = resolvePrimaryCheckingBalance([
    account({
      id: "older-checking",
      name: "Everyday Checking",
      mask: "4444",
      currentBalance: 300,
      availableBalance: 300,
    }),
    account({
      id: "capital-one-savings",
      name: "Capital One 360 Performance Savings",
      type: "savings",
      mask: "2222",
      currentBalance: 500,
      availableBalance: 500,
    }),
    account({
      id: "capital-one-360",
      name: "Capital One 360 Checking",
      mask: "1111",
      currentBalance: 1200,
      availableBalance: 1150,
    }),
  ]);

  assert.deepEqual(primary, {
    accountId: "capital-one-360",
    accountName: "Capital One 360 Checking",
    institution: "Capital One",
    mask: "1111",
    currentBalance: 1200,
    availableBalance: 1150,
  });
});
