import { normalizeMerchant } from "./normalize.ts";
import type { Category, Rule, Transaction } from "../types/finance.ts";

export type RuleSuggestionDraft = {
  categoryId: string;
  categoryLabel: string;
  matchStrategy: Rule["matchStrategy"];
  matchValue: string;
  ruleName: string;
  ruleDescription: string;
};

const internalCategoryIds = new Set(["transfers", "credit-card-payment"]);

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function buildRuleSuggestionDraft({
  transaction,
  category,
  matchStrategy = "merchant_contains",
}: {
  transaction: Pick<
    Transaction,
    "merchantRaw" | "merchantNorm" | "descriptionNorm" | "transactionClass"
  >;
  category: Pick<Category, "id" | "label">;
  matchStrategy?: Rule["matchStrategy"];
}): RuleSuggestionDraft | null {
  if (internalCategoryIds.has(category.id)) {
    return null;
  }

  if (
    transaction.transactionClass === "transfer" ||
    transaction.transactionClass === "credit_payment"
  ) {
    return null;
  }

  const normalizedMerchant =
    transaction.merchantNorm ||
    normalizeMerchant(transaction.merchantRaw) ||
    transaction.descriptionNorm;
  const matchValue = normalizedMerchant.trim();

  if (!matchValue) {
    return null;
  }

  const merchantLabel = titleCase(matchValue);

  return {
    categoryId: category.id,
    categoryLabel: category.label,
    matchStrategy,
    matchValue,
    ruleName: `${merchantLabel} -> ${category.label}`,
    ruleDescription: `Learned from manual categorization of ${merchantLabel}.`,
  };
}
