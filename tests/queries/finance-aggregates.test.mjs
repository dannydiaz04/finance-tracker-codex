import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCashflowByCategoryFromTransactions,
  deriveCashflowFromTransactions,
} from "../../lib/queries/finance-aggregates.ts";

function transaction(overrides = {}) {
  const signedAmount = overrides.signedAmount ?? -10;

  return {
    transactionId: overrides.transactionId ?? "txn-1",
    sourceTransactionId: overrides.sourceTransactionId ?? overrides.transactionId ?? "src-1",
    canonicalGroupId: overrides.canonicalGroupId ?? "group-1",
    accountId: overrides.accountId ?? "acct-1",
    accountName: overrides.accountName ?? "Checking",
    sourceName: overrides.sourceName ?? "plaid",
    accountType: overrides.accountType ?? "checking",
    authorizedAt: overrides.authorizedAt ?? null,
    postedAt: overrides.postedAt ?? "2026-05-01",
    pending: overrides.pending ?? false,
    direction:
      overrides.direction ?? (signedAmount >= 0 ? "inflow" : "outflow"),
    transactionClass: overrides.transactionClass ?? "expense",
    signedAmount,
    merchantRaw: overrides.merchantRaw ?? "Merchant",
    merchantNorm: overrides.merchantNorm ?? "merchant",
    descriptionRaw: overrides.descriptionRaw ?? "Merchant purchase",
    descriptionNorm: overrides.descriptionNorm ?? "merchant purchase",
    institutionCategory: overrides.institutionCategory ?? null,
    derivedCategoryId: overrides.derivedCategoryId ?? "groceries",
    categoryGroup: overrides.categoryGroup ?? "Needs",
    categoryLabel: overrides.categoryLabel ?? "Groceries",
    subcategoryId: overrides.subcategoryId ?? null,
    confidenceScore: overrides.confidenceScore ?? 0.9,
    classificationSource: overrides.classificationSource ?? "merchant_rule",
    ruleId: overrides.ruleId ?? "rule-1",
    isTransfer: overrides.isTransfer ?? false,
    isDuplicate: overrides.isDuplicate ?? false,
    notes: overrides.notes ?? [],
    keywordArray: overrides.keywordArray ?? [],
    rawPayloadJson: overrides.rawPayloadJson ?? {},
    classificationHistory: overrides.classificationHistory ?? [],
  };
}

test("deriveCashflowFromTransactions separates inflow, outflow, and internal movement by date", () => {
  const cashflow = deriveCashflowFromTransactions([
    transaction({
      transactionId: "groceries",
      postedAt: "2026-05-02",
      signedAmount: -40,
      transactionClass: "expense",
    }),
    transaction({
      transactionId: "refund",
      postedAt: "2026-05-02",
      signedAmount: 10,
      transactionClass: "refund",
      derivedCategoryId: "refunds",
      categoryLabel: "Refunds",
    }),
    transaction({
      transactionId: "paycheck",
      postedAt: "2026-05-03",
      signedAmount: 1000,
      transactionClass: "income",
      derivedCategoryId: "salary",
      categoryLabel: "Salary",
    }),
    transaction({
      transactionId: "transfer",
      postedAt: "2026-05-02",
      signedAmount: -2000,
      transactionClass: "transfer",
      derivedCategoryId: "transfer",
      categoryLabel: "Transfers",
      isTransfer: true,
    }),
    transaction({
      transactionId: "credit-card-payment",
      postedAt: "2026-05-03",
      signedAmount: -500,
      transactionClass: "credit_payment",
      derivedCategoryId: "credit-card-payments",
      categoryLabel: "Credit Card Payments",
    }),
  ]);

  assert.deepEqual(cashflow, [
    { date: "2026-05-03", inflow: 1000, outflow: 0, net: 1000 },
    { date: "2026-05-02", inflow: 10, outflow: 40, net: -30 },
  ]);
});

test("deriveCashflowByCategoryFromTransactions keeps refunds as inflow and ranks spending slices", () => {
  const slices = deriveCashflowByCategoryFromTransactions([
    transaction({
      transactionId: "whole-foods",
      merchantRaw: "Whole Foods",
      merchantNorm: "whole foods",
      signedAmount: -60,
    }),
    transaction({
      transactionId: "corner-market",
      merchantRaw: "Corner Market",
      merchantNorm: "corner market",
      signedAmount: -15,
    }),
    transaction({
      transactionId: "grocery-refund",
      merchantRaw: "Whole Foods",
      merchantNorm: "whole foods",
      signedAmount: 20,
      transactionClass: "refund",
    }),
    transaction({
      transactionId: "cafe-1",
      merchantRaw: "Cafe",
      merchantNorm: "cafe",
      signedAmount: -30,
      derivedCategoryId: "dining",
      categoryGroup: "Lifestyle",
      categoryLabel: "Dining",
    }),
    transaction({
      transactionId: "cafe-2",
      merchantRaw: "Cafe",
      merchantNorm: "cafe",
      signedAmount: -20,
      derivedCategoryId: "dining",
      categoryGroup: "Lifestyle",
      categoryLabel: "Dining",
    }),
    transaction({
      transactionId: "bakery",
      merchantRaw: "Bakery",
      merchantNorm: "bakery",
      signedAmount: -10,
      derivedCategoryId: "dining",
      categoryGroup: "Lifestyle",
      categoryLabel: "Dining",
    }),
    transaction({
      transactionId: "taco-shop",
      merchantRaw: "Taco Shop",
      merchantNorm: "taco shop",
      signedAmount: -5,
      derivedCategoryId: "dining",
      categoryGroup: "Lifestyle",
      categoryLabel: "Dining",
    }),
    transaction({
      transactionId: "deli",
      merchantRaw: "Deli",
      merchantNorm: "deli",
      signedAmount: -3,
      derivedCategoryId: "dining",
      categoryGroup: "Lifestyle",
      categoryLabel: "Dining",
    }),
    transaction({
      transactionId: "paycheck",
      merchantRaw: "Employer",
      merchantNorm: "employer",
      signedAmount: 1000,
      transactionClass: "income",
      derivedCategoryId: "salary",
      categoryGroup: "Income",
      categoryLabel: "Salary",
    }),
    transaction({
      transactionId: "transfer",
      signedAmount: -999,
      transactionClass: "transfer",
      derivedCategoryId: "transfers",
      categoryGroup: "Internal",
      categoryLabel: "Transfers",
      isTransfer: true,
    }),
    transaction({
      transactionId: "credit-card-payment",
      signedAmount: -555,
      transactionClass: "credit_payment",
      derivedCategoryId: "credit-card-payments",
      categoryGroup: "Internal",
      categoryLabel: "Credit Card Payments",
    }),
  ]);

  assert.deepEqual(
    slices.map((slice) => slice.categoryId),
    ["groceries", "dining", "salary"],
  );

  const groceries = slices[0];
  assert.equal(groceries.inflow, 20);
  assert.equal(groceries.outflow, 75);
  assert.equal(groceries.net, -55);
  assert.equal(groceries.transactionCount, 3);
  assert.equal(groceries.averageOutflow, 37.5);
  assert.equal(groceries.outflowShare, 75 / 143);
  assert.deepEqual(groceries.topMerchants, [
    { merchant: "Whole Foods", amount: 60, transactionCount: 1 },
    { merchant: "Corner Market", amount: 15, transactionCount: 1 },
  ]);

  const dining = slices[1];
  assert.equal(dining.outflow, 68);
  assert.equal(dining.averageOutflow, 13.6);
  assert.equal(dining.outflowShare, 68 / 143);
  assert.deepEqual(dining.topMerchants, [
    { merchant: "Cafe", amount: 50, transactionCount: 2 },
    { merchant: "Bakery", amount: 10, transactionCount: 1 },
    { merchant: "Taco Shop", amount: 5, transactionCount: 1 },
  ]);

  const salary = slices[2];
  assert.equal(salary.inflow, 1000);
  assert.equal(salary.outflow, 0);
  assert.equal(salary.net, 1000);
  assert.equal(salary.outflowShare, 0);
  assert.equal(salary.averageOutflow, 0);
  assert.deepEqual(salary.topMerchants, []);

  const totalShare = slices.reduce((sum, slice) => sum + slice.outflowShare, 0);
  assert.ok(Math.abs(totalShare - 1) < Number.EPSILON);
});

test("deriveCashflowByCategoryFromTransactions uses zero shares when there is no outflow", () => {
  const slices = deriveCashflowByCategoryFromTransactions([
    transaction({
      transactionId: "interest",
      signedAmount: 12,
      transactionClass: "income",
      derivedCategoryId: "interest",
      categoryGroup: "Income",
      categoryLabel: "Interest",
    }),
  ]);

  assert.deepEqual(slices, [
    {
      categoryId: "interest",
      label: "Interest",
      inflow: 12,
      outflow: 0,
      net: 12,
      transactionCount: 1,
      outflowShare: 0,
      averageOutflow: 0,
      topMerchants: [],
    },
  ]);
});
