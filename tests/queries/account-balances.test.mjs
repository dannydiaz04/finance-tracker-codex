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
    mask: "1234",
    currentBalance: 100,
    availableBalance: 100,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity keeps the richer copy of the same account", () => {
  const duplicateFromCore = account({
    id: "core-checking",
    institution: "Capital   One",
    name: " capital one 360 checking ",
    currentBalance: 0,
    availableBalance: 0,
  });
  const duplicateFromPlaid = account({
    id: "plaid-checking",
    name: "Capital One 360 Checking",
    currentBalance: 1245.67,
    availableBalance: 1200.67,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    duplicateFromCore,
    account({ id: "savings", name: "Savings", type: "savings", mask: "9876" }),
    duplicateFromPlaid,
  ]);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["plaid-checking", "savings"],
  );
});

test("deriveBalanceTotalsFromAccounts treats credit-card balances as debt", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({
      id: "checking",
      name: "Checking",
      type: "checking",
      currentBalance: 1200,
      availableBalance: 900,
    }),
    account({
      id: "savings",
      name: "Savings",
      type: "savings",
      mask: "2222",
      currentBalance: 200,
      availableBalance: 200,
    }),
    account({
      id: "card",
      name: "Venture Card",
      type: "credit",
      subtype: "credit card",
      mask: "3333",
      currentBalance: 450,
      availableBalance: 1550,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: 950,
    availableCash: 1100,
    availableCredit: 1550,
    debtTotal: 450,
    spendingPower: 2650,
  });
});

test("deriveBalanceTotalsFromAccounts scopes selected accounts before deduping", () => {
  const totals = deriveBalanceTotalsFromAccounts(
    [
      account({
        id: "selected-core-checking",
        currentBalance: 100,
        availableBalance: 90,
      }),
      account({
        id: "unselected-plaid-checking",
        currentBalance: 1000,
        availableBalance: 950,
      }),
    ],
    ["selected-core-checking"],
  );

  assert.deepEqual(totals, {
    totalBalance: 100,
    availableCash: 90,
    availableCredit: 0,
    debtTotal: 0,
    spendingPower: 90,
  });
});

test("resolvePrimaryCheckingBalance prefers the Capital One 360 checking account", () => {
  const primary = resolvePrimaryCheckingBalance([
    account({
      id: "capital-one-basic",
      name: "Capital One Checking",
      currentBalance: 25,
      availableBalance: 25,
    }),
    account({
      id: "capital-one-360",
      name: "Capital One 360 Checking",
      currentBalance: 4321.98,
      availableBalance: 4000.98,
    }),
    account({
      id: "other-bank-checking",
      name: "Everyday Checking",
      institution: "Other Bank",
      currentBalance: 900,
      availableBalance: 850,
    }),
  ]);

  assert.deepEqual(primary, {
    accountId: "capital-one-360",
    accountName: "Capital One 360 Checking",
    institution: "Capital One",
    mask: "1234",
    currentBalance: 4321.98,
    availableBalance: 4000.98,
  });
});
