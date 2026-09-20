import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides) {
  return {
    id: overrides.id,
    name: overrides.name ?? "Checking",
    institution: overrides.institution ?? "Capital One",
    type: overrides.type ?? "checking",
    subtype: overrides.subtype ?? overrides.type ?? "checking",
    currency: "USD",
    mask: overrides.mask ?? "1234",
    currentBalance: overrides.currentBalance ?? 0,
    availableBalance: overrides.availableBalance ?? overrides.currentBalance ?? 0,
  };
}

test("dedupes logical accounts and keeps the richer balance row", () => {
  const accounts = [
    account({
      id: "csv-shadow",
      name: "360 Checking",
      institution: "Capital One",
      currentBalance: 0,
      availableBalance: 0,
      mask: "5980",
    }),
    account({
      id: "plaid-live",
      name: "360 Checking",
      institution: "Capital One",
      currentBalance: 1420.32,
      availableBalance: 1388.12,
      mask: "5980",
    }),
    account({
      id: "savings",
      name: "Performance Savings",
      institution: "Capital One",
      type: "savings",
      currentBalance: 5000,
      availableBalance: 5000,
      mask: "7777",
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((item) => item.id),
    ["plaid-live", "savings"],
  );
});

test("derives spending power and debt without double-counting duplicate accounts", () => {
  const accounts = [
    account({
      id: "checking-a",
      name: "Everyday Checking",
      currentBalance: 1000,
      availableBalance: 950,
      mask: "1111",
    }),
    account({
      id: "checking-b",
      name: "Everyday Checking",
      currentBalance: 1000,
      availableBalance: 950,
      mask: "1111",
    }),
    account({
      id: "card",
      name: "Rewards Card",
      institution: "Chase",
      type: "credit",
      subtype: "credit card",
      currentBalance: 320,
      availableBalance: 4680,
      mask: "2222",
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 680,
    availableCash: 950,
    availableCredit: 4680,
    debtTotal: 320,
    spendingPower: 5630,
  });
});

test("scopes account ids before dedupe so selected totals reflect the chosen row", () => {
  const accounts = [
    account({
      id: "stale-selected",
      name: "Everyday Checking",
      currentBalance: 0,
      availableBalance: 0,
      mask: "1111",
    }),
    account({
      id: "live-unselected",
      name: "Everyday Checking",
      currentBalance: 1000,
      availableBalance: 950,
      mask: "1111",
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts, ["stale-selected"]), {
    totalBalance: 0,
    availableCash: 0,
    availableCredit: 0,
    debtTotal: 0,
    spendingPower: 0,
  });
});

test("resolves the Capital One 360 checking balance when multiple checking rows exist", () => {
  const accounts = [
    account({
      id: "legacy-capital-one",
      name: "Essential Checking",
      currentBalance: 200,
      availableBalance: 200,
      mask: "0001",
    }),
    account({
      id: "primary-360",
      name: "360 Checking",
      institution: "CapitalOne",
      currentBalance: 1984.55,
      availableBalance: 1975.01,
      mask: "5980",
    }),
    account({
      id: "external",
      name: "Checking",
      institution: "Other Bank",
      currentBalance: 9999,
      availableBalance: 9999,
      mask: "9999",
    }),
  ];

  assert.deepEqual(resolvePrimaryCheckingBalance(accounts), {
    accountId: "primary-360",
    accountName: "360 Checking",
    institution: "CapitalOne",
    mask: "5980",
    currentBalance: 1984.55,
    availableBalance: 1975.01,
  });
});
