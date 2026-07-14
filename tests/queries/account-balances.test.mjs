import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  return {
    id: "account-1",
    name: "Capital One 360 Checking",
    institution: "Capital One",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "5980",
    currentBalance: 2500,
    availableBalance: 2400,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity collapses case and whitespace variants", () => {
  const accounts = [
    account({
      id: "csv-placeholder",
      institution: " capital   one ",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid-live",
      institution: "Capital One",
      currentBalance: 2500,
      availableBalance: 2400,
    }),
    account({
      id: "apple-card",
      name: "Apple Card",
      institution: "Apple",
      type: "credit",
      subtype: "credit card",
      mask: "1111",
      currentBalance: 300,
      availableBalance: 700,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ["apple-card", "plaid-live"],
  );
});

test("deriveBalanceTotalsFromAccounts does not double-count duplicate accounts", () => {
  const totals = deriveBalanceTotalsFromAccounts([
    account({ id: "checking-a" }),
    account({ id: "checking-b" }),
    account({
      id: "savings",
      name: "Emergency Savings",
      institution: "Capital One",
      type: "savings",
      subtype: "savings",
      mask: "2222",
      currentBalance: 1000,
      availableBalance: 900,
    }),
    account({
      id: "credit-a",
      name: "Travel Rewards",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "3333",
      currentBalance: 300,
      availableBalance: 700,
    }),
    account({
      id: "credit-b",
      name: "Travel Rewards",
      institution: "CHASE",
      type: "credit",
      subtype: "credit card",
      mask: "3333",
      currentBalance: 300,
      availableBalance: 700,
    }),
  ]);

  assert.deepEqual(totals, {
    totalBalance: 3200,
    availableCash: 3300,
    availableCredit: 700,
    debtTotal: 300,
    spendingPower: 4000,
  });
});

test("deriveBalanceTotalsFromAccounts scopes by selected account ids before dedupe", () => {
  const totals = deriveBalanceTotalsFromAccounts(
    [
      account({ id: "checking-a" }),
      account({ id: "checking-b" }),
      account({
        id: "credit-a",
        name: "Travel Rewards",
        institution: "Chase",
        type: "credit",
        subtype: "credit card",
        mask: "3333",
        currentBalance: 300,
        availableBalance: 700,
      }),
      account({
        id: "credit-b",
        name: "Travel Rewards",
        institution: "Chase",
        type: "credit",
        subtype: "credit card",
        mask: "3333",
        currentBalance: 300,
        availableBalance: 700,
      }),
    ],
    ["checking-b", "credit-b"],
  );

  assert.deepEqual(totals, {
    totalBalance: 2200,
    availableCash: 2400,
    availableCredit: 700,
    debtTotal: 300,
    spendingPower: 3100,
  });
});

test("resolvePrimaryCheckingBalance picks the Capital One 360 checking account", () => {
  const primary = resolvePrimaryCheckingBalance([
    account({
      id: "capital-one-total-control",
      name: "Total Control Checking",
      currentBalance: 100,
      availableBalance: 100,
    }),
    account({
      id: "capital-one-360",
      name: "360 Checking",
      currentBalance: 2500,
      availableBalance: 2400,
    }),
    account({
      id: "external-checking",
      name: "Everyday Checking",
      institution: "Local Bank",
      currentBalance: 900,
      availableBalance: 850,
    }),
  ]);

  assert.deepEqual(primary, {
    accountId: "capital-one-360",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 2500,
    availableBalance: 2400,
  });
});
