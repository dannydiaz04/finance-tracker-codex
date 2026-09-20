import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides) {
  return {
    id: "account",
    name: "Checking",
    institution: "Bank",
    type: "checking",
    subtype: "checking",
    currency: "USD",
    mask: "0000",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupes logical account rows and keeps the richer warehouse balance", () => {
  const accounts = [
    account({
      id: "csv-checking",
      name: "360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1200,
      availableBalance: 0,
    }),
    account({
      id: "plaid-checking",
      name: "  360   Checking ",
      institution: " capital   one ",
      mask: "5980",
      currentBalance: 1250,
      availableBalance: 1240,
    }),
    account({
      id: "savings",
      name: "Performance Savings",
      institution: "Capital One",
      type: "savings",
      subtype: "savings",
      mask: "1111",
      currentBalance: 5000,
      availableBalance: 4900,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((row) => row.id),
    ["plaid-checking", "savings"],
  );
});

test("derives balance totals without double-counting duplicate cash or credit accounts", () => {
  const accounts = [
    account({
      id: "csv-checking",
      name: "360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1200,
      availableBalance: 0,
    }),
    account({
      id: "plaid-checking",
      name: "360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1250,
      availableBalance: 1240,
    }),
    account({
      id: "savings",
      name: "Performance Savings",
      institution: "Capital One",
      type: "savings",
      subtype: "savings",
      mask: "1111",
      currentBalance: 5000,
      availableBalance: 4900,
    }),
    account({
      id: "csv-card",
      name: "Venture Card",
      institution: "Capital One",
      type: "credit",
      subtype: "credit card",
      mask: "2222",
      currentBalance: 999,
      availableBalance: 0,
    }),
    account({
      id: "plaid-card",
      name: "Venture Card",
      institution: "Capital One",
      type: "credit",
      subtype: "credit card",
      mask: "2222",
      currentBalance: 300,
      availableBalance: 1700,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 5950,
    availableCash: 6140,
    availableCredit: 1700,
    debtTotal: 300,
    spendingPower: 7840,
  });
});

test("applies selected account scoping before logical dedupe", () => {
  const accounts = [
    account({
      id: "csv-checking",
      name: "360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1200,
      availableBalance: 0,
    }),
    account({
      id: "plaid-checking",
      name: "360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1250,
      availableBalance: 1240,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts, ["csv-checking"]), {
    totalBalance: 1200,
    availableCash: 0,
    availableCredit: 0,
    debtTotal: 0,
    spendingPower: 0,
  });
});

test("resolves the Capital One 360 checking balance from deduped accounts", () => {
  const primary = resolvePrimaryCheckingBalance([
    account({
      id: "legacy-checking",
      name: "Everyday Checking",
      institution: "CapitalOne",
      mask: "1111",
      currentBalance: 250,
      availableBalance: 245,
    }),
    account({
      id: "primary-checking",
      name: "360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1250,
      availableBalance: 1240,
    }),
  ]);

  assert.deepEqual(primary, {
    accountId: "primary-checking",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 1250,
    availableBalance: 1240,
  });
});
