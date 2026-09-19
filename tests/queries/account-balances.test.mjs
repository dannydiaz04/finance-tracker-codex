import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolveCapitalOneCheckingAccount,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides = {}) {
  const id = overrides.id ?? "acct-1";

  return {
    id,
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

test("dedupeAccountsByLogicalIdentity keeps the richer row for the same logical account", () => {
  const deduped = dedupeAccountsByLogicalIdentity([
    account({
      id: "csv-capital-one",
      name: "Capital   One 360 Checking",
      institution: " Capital One ",
      mask: "1234",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid-capital-one",
      name: "capital one 360 checking",
      institution: "capital   one",
      mask: "1234",
      currentBalance: 1420.55,
      availableBalance: 1395.55,
    }),
    account({
      id: "savings",
      name: "Emergency Savings",
      institution: "Capital One",
      type: "savings",
      subtype: "savings",
      mask: "9876",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
  ]);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["plaid-capital-one", "savings"],
  );
  assert.equal(deduped[0].currentBalance, 1420.55);
  assert.equal(deduped[0].availableBalance, 1395.55);
});

test("deriveBalanceTotalsFromAccounts dedupes accounts and separates cash, credit, and debt totals", () => {
  const accounts = [
    account({
      id: "checking",
      currentBalance: 1000,
      availableBalance: 900,
    }),
    account({
      id: "checking-duplicate",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "savings",
      name: "Savings",
      type: "savings",
      subtype: "savings",
      mask: "9876",
      currentBalance: 500,
      availableBalance: 500,
    }),
    account({
      id: "credit-card",
      name: "Venture Card",
      type: "credit",
      subtype: "credit_card",
      mask: "4444",
      currentBalance: 200,
      availableBalance: 1800,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 1300,
    availableCash: 1400,
    availableCredit: 1800,
    debtTotal: 200,
    spendingPower: 3200,
  });

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts, ["checking", "credit-card"]), {
    totalBalance: 800,
    availableCash: 900,
    availableCredit: 1800,
    debtTotal: 200,
    spendingPower: 2700,
  });
});

test("Capital One primary checking resolution prefers the 360 checking account after dedupe", () => {
  const accounts = [
    account({
      id: "cap-one-legacy",
      name: "Capital One Checking",
      institution: "CapitalOne",
      currentBalance: 300,
      availableBalance: 300,
    }),
    account({
      id: "cap-one-360-empty",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "cap-one-360-live",
      name: "capital one 360 checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1240.1,
      availableBalance: 1200.1,
    }),
  ];

  const accountMatch = resolveCapitalOneCheckingAccount(accounts);
  const balance = resolvePrimaryCheckingBalance(accounts);

  assert.equal(accountMatch?.id, "cap-one-360-live");
  assert.deepEqual(balance, {
    accountId: "cap-one-360-live",
    accountName: "capital one 360 checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 1240.1,
    availableBalance: 1200.1,
  });
});
