import assert from "node:assert/strict";
import test from "node:test";

import { buildRuleSuggestionDraft } from "../../lib/categorization/rule-suggestions.ts";

const groceryCategory = {
  id: "groceries",
  label: "Groceries",
};

test("Manual category corrections suggest merchant-contains rules", () => {
  const draft = buildRuleSuggestionDraft({
    transaction: {
      merchantRaw: "WHOLEFOODS 10429",
      merchantNorm: "wholefoods 10429",
      descriptionNorm: "wholefoods 10429 chicago il",
      transactionClass: "expense",
    },
    category: groceryCategory,
  });

  assert.deepEqual(draft, {
    categoryId: "groceries",
    categoryLabel: "Groceries",
    matchStrategy: "merchant_contains",
    matchValue: "wholefoods 10429",
    ruleName: "Wholefoods 10429 -> Groceries",
    ruleDescription: "Learned from manual categorization of Wholefoods 10429.",
  });
});

test("Manual corrections do not suggest deterministic rules for internal movements", () => {
  const draft = buildRuleSuggestionDraft({
    transaction: {
      merchantRaw: "Withdrawal from APPLECARD GSBANK PAYMENT",
      merchantNorm: "withdrawal from applecard gsbank payment",
      descriptionNorm: "withdrawal from applecard gsbank payment",
      transactionClass: "credit_payment",
    },
    category: {
      id: "credit-card-payment",
      label: "Credit Card Payments",
    },
  });

  assert.equal(draft, null);
});
