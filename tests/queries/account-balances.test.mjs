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
    id: "acct-default",
    name: "Everyday Checking",
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

test("dedupes logical account identities and keeps the richer balance row", () => {
  const sparseDuplicate = account({
    id: "csv-checking",
    institution: " capital   one ",
    currentBalance: 0,
    availableBalance: 0,
  });
  const richerDuplicate = account({
    id: "plaid-checking",
    institution: "Capital One",
    currentBalance: 1250,
    availableBalance: 1200,
  });
  const savings = account({
    id: "savings",
    name: "Savings",
    type: "savings",
    subtype: "savings",
    currentBalance: 5000,
    availableBalance: 5000,
  });

  const deduped = dedupeAccountsByLogicalIdentity([
    sparseDuplicate,
    savings,
    richerDuplicate,
  ]);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["plaid-checking", "savings"],
  );
});

test("balance totals dedupe duplicate rows before summing headline money values", () => {
  const accounts = [
    account({
      id: "csv-checking",
      currentBalance: 0,
      availableBalance: 0,
    }),
    account({
      id: "plaid-checking",
      currentBalance: 5000,
      availableBalance: 4800,
    }),
    account({
      id: "card",
      name: "Rewards Card",
      type: "credit",
      subtype: "credit card",
      currentBalance: 750,
      availableBalance: 9250,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 4250,
    availableCash: 4800,
    availableCredit: 9250,
    debtTotal: 750,
    spendingPower: 14050,
  });
});

test("selected account totals scope before dedupe to avoid leaking sibling balances", () => {
  const accounts = [
    account({
      id: "selected-csv-checking",
      currentBalance: 100,
      availableBalance: 90,
    }),
    account({
      id: "unselected-plaid-checking",
      currentBalance: 5000,
      availableBalance: 4800,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, ["selected-csv-checking"]),
    {
      totalBalance: 100,
      availableCash: 90,
      availableCredit: 0,
      debtTotal: 0,
      spendingPower: 90,
    },
  );
});

test("credit cards count as debt while available limits add to spending power", () => {
  const accounts = [
    account({
      id: "checking",
      currentBalance: 10000,
      availableBalance: 9500,
    }),
    account({
      id: "rewards-card",
      name: "Rewards Card",
      type: "credit",
      subtype: "credit card",
      currentBalance: 2000,
      availableBalance: 8000,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 8000,
    availableCash: 9500,
    availableCredit: 8000,
    debtTotal: 2000,
    spendingPower: 17500,
  });
});

test("resolves the Capital One 360 checking account for live balance display", () => {
  const accounts = [
    account({
      id: "capital-one-regular",
      name: "Total Control Checking",
      currentBalance: 400,
      availableBalance: 400,
    }),
    account({
      id: "capital-one-360",
      name: "360 Checking",
      currentBalance: 1234,
      availableBalance: 1200,
    }),
    account({
      id: "other-checking",
      institution: "Other Bank",
      currentBalance: 9999,
      availableBalance: 9999,
    }),
  ];

  assert.equal(resolveCapitalOneCheckingAccount(accounts)?.id, "capital-one-360");
  assert.deepEqual(resolvePrimaryCheckingBalance(accounts), {
    accountId: "capital-one-360",
    accountName: "360 Checking",
    institution: "Capital One",
    mask: "1234",
    currentBalance: 1234,
    availableBalance: 1200,
  });
});
