import { normalizeDescription, normalizeMerchant } from "@/lib/categorization/normalize";
import type {
  ClassificationSource,
  Rule,
  Transaction,
  TransactionClass,
} from "@/lib/types/finance";

export type ClassificationResult = {
  categoryId: string;
  categoryLabel: string;
  confidenceScore: number;
  source: ClassificationSource;
  ruleId: string | null;
};

export function classifyMovementType(
  amount: number,
  description: string,
): TransactionClass {
  const normalized = normalizeDescription(description);

  if (/transfer|zelle|venmo cashout|ach transfer/.test(normalized)) {
    return "transfer";
  }

  if (/credit card payment|card payment/.test(normalized)) {
    return "credit_payment";
  }

  if (/refund|reversal|return/.test(normalized)) {
    return "refund";
  }

  if (/fee|service charge|atm fee/.test(normalized)) {
    return "fee";
  }

  if (amount > 0) {
    return "income";
  }

  return "expense";
}

export function applyCategoryRules(
  transaction: Pick<
    Transaction,
    "merchantRaw" | "descriptionRaw" | "institutionCategory"
  >,
  rules: Rule[],
): ClassificationResult | null {
  const merchantNorm = normalizeMerchant(transaction.merchantRaw);
  const descriptionNorm = normalizeDescription(transaction.descriptionRaw);

  for (const rule of [...rules].sort((a, b) => b.priority - a.priority)) {
    if (!rule.enabled) {
      continue;
    }

    const matches =
      (rule.matchStrategy === "merchant_exact" &&
        merchantNorm === normalizeMerchant(rule.matchValue)) ||
      (rule.matchStrategy === "merchant_contains" &&
        merchantNorm.includes(normalizeMerchant(rule.matchValue))) ||
      (rule.matchStrategy === "description_regex" &&
        new RegExp(rule.matchValue, "i").test(descriptionNorm));

    if (!matches) {
      continue;
    }

    return {
      categoryId: rule.categoryId,
      categoryLabel: rule.categoryLabel,
      confidenceScore: rule.confidenceBoost,
      source: "merchant_rule",
      ruleId: rule.id,
    };
  }

  if (transaction.institutionCategory) {
    return {
      categoryId: normalizeMerchant(transaction.institutionCategory).replace(
        /\s+/g,
        "-",
      ),
      categoryLabel: transaction.institutionCategory,
      confidenceScore: 0.7,
      source: "institution_category",
      ruleId: null,
    };
  }

  return null;
}
