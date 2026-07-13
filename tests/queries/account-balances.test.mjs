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
    id: "acct-base",
    name: "Everyday Checking",
    institution: "Acme Bank",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "1234",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity collapses equivalent account rows and keeps the richer record", () => {
  const accounts = [
    account({
      id: "placeholder-cap-one",
      name: "capital one   360 checking",
      institution: " capital one ",
      mask: "5980",
    }),
    account({
      id: "live-cap-one",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1250.75,
      availableBalance: 1225.5,
    }),
    account({
      id: "travel-card",
      name: "Travel Card",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "9911",
      currentBalance: 240.1,
      availableBalance: 1759.9,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ["live-cap-one", "travel-card"],
  );
  assert.equal(deduped[0].currentBalance, 1250.75);
  assert.equal(deduped[0].availableBalance, 1225.5);
});

test("deriveBalanceTotalsFromAccounts treats credit balances as debt and does not double count duplicates", () => {
  const accounts = [
    account({
      id: "checking-live",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1200,
      availableBalance: 1100,
    }),
    account({
      id: "checking-duplicate",
      name: " capital one   360 checking ",
      institution: "capitalone",
      mask: "5980",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "credit-live",
      name: "Travel Card",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "9911",
      currentBalance: 200,
      availableBalance: 800,
    }),
    account({
      id: "credit-duplicate",
      name: "Travel   Card",
      institution: "CHASE",
      type: "credit",
      subtype: "credit card",
      mask: "9911",
      currentBalance: 200,
      availableBalance: 800,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 1000,
    availableCash: 1100,
    availableCredit: 800,
    debtTotal: 200,
    spendingPower: 1900,
  });
});

test("deriveBalanceTotalsFromAccounts scopes by selected account ids before totaling", () => {
  const accounts = [
    account({
      id: "checking-live",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1200,
      availableBalance: 1100,
    }),
    account({
      id: "savings-live",
      name: "High Yield Savings",
      institution: "Capital One",
      type: "savings",
      subtype: "savings",
      mask: "4422",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
    account({
      id: "credit-live",
      name: "Travel Card",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "9911",
      currentBalance: 200,
      availableBalance: 800,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, ["checking-live", "credit-live"]),
    {
      totalBalance: 1000,
      availableCash: 1100,
      availableCredit: 800,
      debtTotal: 200,
      spendingPower: 1900,
    },
  );
});

test("resolveCapitalOneCheckingAccount prefers the 360 checking account and returns a primary balance DTO", () => {
  const accounts = [
    account({
      id: "cap-one-performance",
      name: "Performance Checking",
      institution: "CapitalOne",
      mask: "7711",
      currentBalance: 90,
      availableBalance: 90,
    }),
    account({
      id: "cap-one-360",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1250.75,
      availableBalance: 1225.5,
    }),
    account({
      id: "other-checking",
      name: "Everyday Checking",
      institution: "Acme Bank",
      mask: "1234",
      currentBalance: 400,
      availableBalance: 400,
    }),
  ];

  assert.equal(resolveCapitalOneCheckingAccount(accounts)?.id, "cap-one-360");
  assert.deepEqual(resolvePrimaryCheckingBalance(accounts), {
    accountId: "cap-one-360",
    accountName: "Capital One 360 Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 1250.75,
    availableBalance: 1225.5,
  });
});
