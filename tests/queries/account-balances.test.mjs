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
    currentBalance: 1200,
    availableBalance: 1000,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity normalizes account identity and keeps the richer duplicate", () => {
  const sparseDuplicate = account({
    id: "csv-checking",
    name: "  Everyday   Checking ",
    institution: " capital one ",
    currentBalance: 0,
    availableBalance: 0,
  });
  const richerDuplicate = account({
    id: "plaid-checking",
    name: "Everyday Checking",
    institution: "Capital One",
    currentBalance: 1200,
    availableBalance: 1000,
  });
  const savings = account({
    id: "savings",
    name: "Savings",
    type: "savings",
    subtype: "savings",
    mask: "5678",
    currentBalance: 5000,
    availableBalance: 5000,
  });

  assert.deepEqual(
    dedupeAccountsByLogicalIdentity([
      savings,
      sparseDuplicate,
      richerDuplicate,
    ]),
    [richerDuplicate, savings],
  );
});

test("deriveBalanceTotalsFromAccounts does not double-count logical duplicates and treats credit balances as debt", () => {
  const duplicateChecking = account({
    id: "csv-checking",
    name: "Everyday Checking",
    currentBalance: 0,
    availableBalance: 0,
  });
  const checking = account({
    id: "plaid-checking",
    name: "Everyday Checking",
    currentBalance: 1200,
    availableBalance: 1000,
  });
  const creditCard = account({
    id: "credit-card",
    name: "Rewards Card",
    institution: "Chase",
    type: "credit",
    subtype: "credit card",
    mask: "9999",
    currentBalance: 400,
    availableBalance: 1600,
  });

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts([duplicateChecking, checking, creditCard]),
    {
      totalBalance: 800,
      availableCash: 1000,
      availableCredit: 1600,
      debtTotal: 400,
      spendingPower: 2600,
    },
  );
});

test("deriveBalanceTotalsFromAccounts scopes selected account ids before deduping", () => {
  const selectedCsvChecking = account({
    id: "csv-checking",
    name: "Everyday Checking",
    currentBalance: 25,
    availableBalance: 25,
  });
  const unselectedPlaidChecking = account({
    id: "plaid-checking",
    name: "Everyday Checking",
    currentBalance: 1200,
    availableBalance: 1000,
  });
  const selectedCreditCard = account({
    id: "credit-card",
    name: "Rewards Card",
    institution: "Chase",
    type: "credit",
    subtype: "credit card",
    mask: "9999",
    currentBalance: 400,
    availableBalance: 1600,
  });

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(
      [selectedCsvChecking, unselectedPlaidChecking, selectedCreditCard],
      ["csv-checking", "credit-card"],
    ),
    {
      totalBalance: -375,
      availableCash: 25,
      availableCredit: 1600,
      debtTotal: 400,
      spendingPower: 1625,
    },
  );
});

test("resolvePrimaryCheckingBalance selects the deduped Capital One 360 checking balance", () => {
  const capitalOneBranchChecking = account({
    id: "capital-one-branch",
    name: "Capital One Checking",
    institution: "CapitalOne",
    currentBalance: 300,
    availableBalance: 250,
  });
  const staleCapitalOne360 = account({
    id: "capital-one-360-csv",
    name: "Capital One 360 Checking",
    currentBalance: 0,
    availableBalance: 0,
    mask: "5980",
  });
  const liveCapitalOne360 = account({
    id: "capital-one-360-plaid",
    name: "Capital One 360 Checking",
    currentBalance: 2400,
    availableBalance: 2350,
    mask: "5980",
  });

  assert.deepEqual(
    resolvePrimaryCheckingBalance([
      capitalOneBranchChecking,
      staleCapitalOne360,
      liveCapitalOne360,
    ]),
    {
      accountId: "capital-one-360-plaid",
      accountName: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 2400,
      availableBalance: 2350,
    },
  );
});
