import { normalizeDescription, normalizeMerchant } from "./normalize.ts";
import type {
  ClassificationSource,
  Rule,
  Transaction,
  TransactionClass,
} from "../types/finance.ts";

export type ClassificationResult = {
  categoryId: string;
  categoryLabel: string;
  confidenceScore: number;
  source: ClassificationSource;
  ruleId: string | null;
};

export type MovementClassificationContext = {
  accountType?: string | null;
  accountSubtype?: string | null;
  institutionCategory?: string | null;
  merchantRaw?: string | null;
  transactionType?: string | null;
};

function normalizeOptionalSignal(value: string | null | undefined) {
  return value ? normalizeDescription(value) : "";
}

function hasCreditCardPaymentPayee(value: string) {
  return /\b(?:apple\s*card|applecard|gsbank|amex|american express|discover|chase credit crd|chase credit card|credit one bank|credit card)\b/.test(
    value,
  );
}

function hasPaymentAction(value: string) {
  return /\b(?:payment|pmt|epay|epayment|debit|debits)\b/.test(value);
}

function hasCreditCardAccountPaymentSignal(
  amount: number,
  description: string,
  context: MovementClassificationContext,
) {
  const accountType = normalizeOptionalSignal(context.accountType);
  const accountSubtype = normalizeOptionalSignal(context.accountSubtype);
  const institutionCategory = normalizeOptionalSignal(context.institutionCategory);
  const transactionType = normalizeOptionalSignal(context.transactionType);

  if (
    amount <= 0 ||
    (accountType !== "credit" && !accountSubtype.includes("credit"))
  ) {
    return false;
  }

  return (
    /\bpayments?(?: and credits?)?\b/.test(institutionCategory) ||
    /\bpayment\b/.test(transactionType) ||
    /\b(?:internet payment|payment thank you)\b/.test(description)
  );
}

function isCreditCardPayment(
  amount: number,
  description: string,
  context: MovementClassificationContext = {},
) {
  const merchant = normalizeOptionalSignal(context.merchantRaw);
  const haystack = [description, merchant].filter(Boolean).join(" ");

  return (
    (amount < 0 &&
      hasCreditCardPaymentPayee(haystack) &&
      hasPaymentAction(haystack)) ||
    hasCreditCardAccountPaymentSignal(amount, description, context)
  );
}

export function classifyMovementType(
  amount: number,
  description: string,
  context: MovementClassificationContext = {},
): TransactionClass {
  const normalized = normalizeDescription(description);

  if (isCreditCardPayment(amount, normalized, context)) {
    return "credit_payment";
  }

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
