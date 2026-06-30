import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeAccountsByLogicalIdentity,
  deriveBalanceTotalsFromAccounts,
  resolvePrimaryCheckingBalance,
} from "../../lib/queries/account-balances.ts";

function account(overrides) {
  return {
    id: "account-id",
    name: "Everyday Checking",
    institution: "Bank",
    type: "checking",
    subtype: "",
    currency: "USD",
    mask: "1234",
    currentBalance: 0,
    availableBalance: 0,
    ...overrides,
  };
}

test("dedupeAccountsByLogicalIdentity collapses normalized duplicates and keeps the most complete row", () => {
  const accounts = [
    account({
      id: "manual-savings",
      name: "Emergency Savings",
      institution: "Credit Union",
      type: "savings",
      mask: "2222",
      currentBalance: 5000,
      availableBalance: 5000,
    }),
    account({
      id: "core-capital-one-360",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
    }),
    account({
      id: "live-capital-one-360",
      name: "  CAPITAL   ONE 360 CHECKING  ",
      institution: "capitalone",
      mask: "5980",
      currentBalance: 1425.2,
      availableBalance: 1390.17,
    }),
  ];

  const deduped = dedupeAccountsByLogicalIdentity(accounts);

  assert.deepEqual(
    deduped.map((dedupedAccount) => dedupedAccount.id),
    ["live-capital-one-360", "manual-savings"],
  );
  assert.equal(deduped[0].currentBalance, 1425.2);
  assert.equal(deduped[0].availableBalance, 1390.17);
});

test("deriveBalanceTotalsFromAccounts counts credit balances as debt after account dedupe", () => {
  const accounts = [
    account({
      id: "checking-core",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
    }),
    account({
      id: "checking-live",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1200,
      availableBalance: 1100,
    }),
    account({
      id: "amex-core",
      name: "American Express Card",
      institution: "American Express",
      type: "credit",
      mask: "2001",
    }),
    account({
      id: "amex-live",
      name: "American Express Card",
      institution: "American Express",
      type: "credit",
      mask: "2001",
      currentBalance: 300,
      availableBalance: 1700,
    }),
    account({
      id: "vacation-savings",
      name: "Vacation Savings",
      institution: "Credit Union",
      type: "savings",
      mask: "7777",
      currentBalance: 2500,
      availableBalance: 2500,
    }),
  ];

  assert.deepEqual(deriveBalanceTotalsFromAccounts(accounts), {
    totalBalance: 3400,
    availableCash: 3600,
    availableCredit: 1700,
    debtTotal: 300,
    spendingPower: 5300,
  });
});

test("deriveBalanceTotalsFromAccounts limits totals to selected account ids before deduping", () => {
  const accounts = [
    account({
      id: "checking-core",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
    }),
    account({
      id: "checking-live",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1200,
      availableBalance: 1100,
    }),
    account({
      id: "amex-live",
      name: "American Express Card",
      institution: "American Express",
      type: "credit",
      mask: "2001",
      currentBalance: 300,
      availableBalance: 1700,
    }),
    account({
      id: "unselected-savings",
      name: "Vacation Savings",
      institution: "Credit Union",
      type: "savings",
      mask: "7777",
      currentBalance: 2500,
      availableBalance: 2500,
    }),
  ];

  assert.deepEqual(
    deriveBalanceTotalsFromAccounts(accounts, ["checking-live", "amex-live"]),
    {
      totalBalance: 900,
      availableCash: 1100,
      availableCredit: 1700,
      debtTotal: 300,
      spendingPower: 2800,
    },
  );
});

test("resolvePrimaryCheckingBalance prefers the deduped Capital One 360 checking account", () => {
  const resolved = resolvePrimaryCheckingBalance([
    account({
      id: "capital-one-core",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
    }),
    account({
      id: "capital-one-live",
      name: "Capital One 360 Checking",
      institution: "Capital One",
      mask: "5980",
      currentBalance: 1200,
      availableBalance: 1100,
    }),
    account({
      id: "capital-one-savings",
      name: "Capital One 360 Performance Savings",
      institution: "Capital One",
      type: "savings",
      mask: "1111",
      currentBalance: 2000,
      availableBalance: 2000,
    }),
    account({
      id: "other-checking",
      name: "Rewards Checking",
      institution: "Credit Union",
      mask: "2222",
      currentBalance: 400,
      availableBalance: 400,
    }),
  ]);

  assert.deepEqual(resolved, {
    accountId: "capital-one-live",
    accountName: "Capital One 360 Checking",
    institution: "Capital One",
    mask: "5980",
    currentBalance: 1200,
    availableBalance: 1100,
  });
});
