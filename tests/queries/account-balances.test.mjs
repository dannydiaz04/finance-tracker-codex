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
    id: "account-id",
    name: "Account",
    institution: "Institution",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "0000",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupes logical accounts and keeps the richest account metadata", () => {
  const accounts = [
    account({
      id: "sparse-checking",
      name: "  Capital   One 360   Checking ",
      institution: " Capital   One ",
      mask: "5980",
    }),
    account({
      id: "rich-checking",
      name: "capital one 360 checking",
      institution: "capital one",
      mask: "5980",
      currentBalance: 1240.1,
      availableBalance: 1199.5,
    }),
    account({
      id: "apple-card",
      name: "Apple Card",
      institution: "Goldman Sachs",
      type: "credit",
      subtype: "credit card",
      mask: "1234",
      currentBalance: 250,
      availableBalance: 4750,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((entry) => entry.id),
    ["apple-card", "rich-checking"],
  );
  assert.equal(deduped[1].currentBalance, 1240.1);
  assert.equal(deduped[1].availableBalance, 1199.5);
});

test("derives balance totals after logical dedupe to avoid double counting", () => {
  const accounts = [
    account({
      id: "checking",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1000,
      availableBalance: 800,
    }),
    account({
      id: "savings",
      name: "Capital One Savings",
      institution: "Capital One",
      type: "savings",
      subtype: "savings",
      mask: "4411",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
    account({
      id: "card",
      name: "Chase Freedom",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      mask: "1325",
      currentBalance: 1200,
      availableBalance: 3800,
    }),
    account({
      id: "card-duplicate",
      name: " chase   freedom ",
      institution: " chase ",
      type: "credit",
      subtype: "credit card",
      mask: "1325",
      currentBalance: 1200,
      availableBalance: 3800,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 4800,
    availableCash: 5800,
    availableCredit: 3800,
    debtTotal: 1200,
    spendingPower: 9600,
  });

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts, ["checking", "card"]), {
    totalBalance: -200,
    availableCash: 800,
    availableCredit: 3800,
    debtTotal: 1200,
    spendingPower: 4600,
  });
});

test("resolves the Capital One 360 checking balance from deduped accounts", () => {
  const accounts = [
    account({
      id: "capital-one-everyday",
      name: "Capital One Checking",
      institution: "Capital One",
      mask: "0001",
      currentBalance: 300,
      availableBalance: 250,
    }),
    account({
      id: "capital-one-360",
      name: "Capital One 360 Checking",
      institution: "CapitalOne",
      mask: "5980",
      currentBalance: 1240.1,
      availableBalance: 1199.5,
    }),
    account({
      id: "capital-one-360-duplicate",
      name: " Capital One 360 Checking ",
      institution: "CapitalOne",
      mask: "5980",
    }),
    account({
      id: "capital-one-card",
      name: "Capital One Venture",
      institution: "Capital One",
      type: "credit",
      subtype: "credit card",
      mask: "9911",
      currentBalance: 900,
      availableBalance: 4100,
    }),
  ];

  const resolved = resolveCapitalOneCheckingAccount(accounts);
  assert.equal(resolved?.id, "capital-one-360");

  assert.deepEqual(resolvePrimaryCheckingBalance(accounts), {
    accountId: "capital-one-360",
    accountName: "Capital One 360 Checking",
    institution: "CapitalOne",
    mask: "5980",
    currentBalance: 1240.1,
    availableBalance: 1199.5,
  });

  assert.equal(
    resolveCapitalOneCheckingAccount([
      account({
        id: "brokerage",
        name: "Brokerage",
        institution: "Capital One",
        type: "brokerage",
        subtype: "investment",
      }),
    ]),
    null,
  );
});
