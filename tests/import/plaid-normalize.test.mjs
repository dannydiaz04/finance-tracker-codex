import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlaidTransaction } from "../../lib/plaid/normalize.ts";

const checkingAccount = {
  account_id: "acc_checking",
  name: "Everyday Checking",
  official_name: "Everyday Checking Account",
  mask: "4321",
  type: "depository",
  subtype: "checking",
  balances: { iso_currency_code: "USD" },
};

const creditAccount = {
  account_id: "acc_credit",
  name: "Travel Card",
  mask: "9911",
  type: "credit",
  subtype: "credit card",
  balances: { iso_currency_code: "USD" },
};

function buildTransaction(overrides = {}) {
  return {
    transaction_id: "txn_1",
    account_id: "acc_checking",
    amount: 12.34,
    iso_currency_code: "USD",
    date: "2026-02-10",
    authorized_date: "2026-02-09",
    authorized_datetime: null,
    datetime: null,
    name: "TARGET STORE 1234",
    merchant_name: "Target",
    pending: false,
    payment_channel: "in store",
    personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_SUPERSTORES" },
    category: ["Shops", "Superstores"],
    ...overrides,
  };
}

test("Plaid outflow flips the sign and classifies as an expense", () => {
  const event = normalizePlaidTransaction(buildTransaction(), checkingAccount, "Acme Bank");

  assert.equal(event.sourceTransactionId, "txn_1");
  assert.equal(event.sourceAccountId, "acc_checking");
  assert.equal(event.accountName, "Everyday Checking");
  assert.equal(event.signedAmount, -12.34);
  assert.equal(event.direction, "outflow");
  assert.equal(event.transactionClass, "expense");
  assert.equal(event.postedAt, "2026-02-10");
  assert.equal(event.authorizedAt, "2026-02-09T00:00:00.000Z");
  assert.equal(event.descriptionRaw, "TARGET STORE 1234");
  assert.equal(event.merchantRaw, "Target");
  assert.equal(event.institutionCategory, "GENERAL_MERCHANDISE");
  assert.equal(event.accountType, "depository");
  assert.equal(event.pending, false);
  assert.ok(event.keywordArray.includes("target"));
});

test("Plaid inflow flips the sign and classifies as income", () => {
  const event = normalizePlaidTransaction(
    buildTransaction({
      transaction_id: "txn_2",
      amount: -2500,
      name: "ACME PAYROLL DIRECT DEP",
      merchant_name: null,
      personal_finance_category: { primary: "INCOME" },
      category: null,
    }),
    checkingAccount,
  );

  assert.equal(event.signedAmount, 2500);
  assert.equal(event.direction, "inflow");
  assert.equal(event.transactionClass, "income");
  // merchant falls back to description when merchant_name is missing
  assert.equal(event.merchantRaw, "ACME PAYROLL DIRECT DEP");
  assert.equal(event.institutionCategory, "INCOME");
});

test("Credit card account context drives credit_payment classification", () => {
  const event = normalizePlaidTransaction(
    buildTransaction({
      transaction_id: "txn_3",
      account_id: "acc_credit",
      amount: -300,
      name: "Payment Thank You",
      merchant_name: null,
      personal_finance_category: { primary: "LOAN_PAYMENTS" },
      category: null,
    }),
    creditAccount,
  );

  assert.equal(event.accountType, "credit");
  assert.equal(event.signedAmount, 300);
  assert.equal(event.transactionClass, "credit_payment");
});

test("authorized_datetime is preferred over authorized_date", () => {
  const event = normalizePlaidTransaction(
    buildTransaction({
      authorized_datetime: "2026-02-09T15:30:00Z",
      authorized_date: "2026-02-09",
    }),
    checkingAccount,
  );

  assert.equal(event.authorizedAt, "2026-02-09T15:30:00.000Z");
});
