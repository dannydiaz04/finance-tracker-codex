// Pure, dependency-free mapping from Plaid's personal_finance_category (PFC)
// taxonomy onto our canonical `dim_category` ids, plus a confidence-weighted
// "prior" that anchors the LLM categorizer.
//
// Kept free of server-only / BigQuery imports so it stays unit-testable in plain
// Node and reusable by the dataform-fed classifier and any future surface.

export type PlaidCategoryConfidenceLevel =
  | "VERY_HIGH"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "UNKNOWN";

export type PlaidCategoryPrior = {
  primary: string | null;
  detailed: string | null;
  confidenceLevel: PlaidCategoryConfidenceLevel;
  /** Mapped canonical category id, or null when no confident mapping exists. */
  categoryId: string | null;
  /** 0..1 strength derived from Plaid's confidence level. */
  weight: number;
};

// Detailed-level mappings take precedence: they disambiguate primaries that
// otherwise split across our taxonomy (groceries vs. dining inside
// FOOD_AND_DRINK, a card payment inside LOAN_PAYMENTS, wages inside INCOME,
// rent inside RENT_AND_UTILITIES).
const DETAILED_TO_CATEGORY: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: "groceries",
  LOAN_PAYMENTS_CREDIT_CARD_PAYMENT: "credit-card-payment",
  INCOME_WAGES: "salary",
  RENT_AND_UTILITIES_RENT: "housing-rent",
};

// Primary-level fallbacks, only where the entire primary maps unambiguously onto
// a single canonical category. Primaries that span several of our categories (or
// none — ENTERTAINMENT, GENERAL_MERCHANDISE, MEDICAL, TRANSPORTATION, …) are
// intentionally left unmapped so the model decides freely rather than anchoring
// on a misleading prior.
const PRIMARY_TO_CATEGORY: Record<string, string> = {
  FOOD_AND_DRINK: "dining",
  BANK_FEES: "fees",
  TRANSFER_IN: "transfers",
  TRANSFER_OUT: "transfers",
  TRAVEL: "travel",
};

const CONFIDENCE_WEIGHT: Record<PlaidCategoryConfidenceLevel, number> = {
  VERY_HIGH: 1,
  HIGH: 0.8,
  MEDIUM: 0.5,
  LOW: 0.2,
  UNKNOWN: 0,
};

function normalizeToken(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePlaidConfidenceLevel(
  value: string | null | undefined,
): PlaidCategoryConfidenceLevel {
  const token = normalizeToken(value);

  if (token && token in CONFIDENCE_WEIGHT) {
    return token as PlaidCategoryConfidenceLevel;
  }

  return "UNKNOWN";
}

export function getPlaidConfidenceWeight(
  level: PlaidCategoryConfidenceLevel,
): number {
  return CONFIDENCE_WEIGHT[level] ?? 0;
}

export function mapPlaidCategoryToTaxonomy(
  primary: string | null | undefined,
  detailed: string | null | undefined,
): string | null {
  const detailedToken = normalizeToken(detailed);

  if (detailedToken && DETAILED_TO_CATEGORY[detailedToken]) {
    return DETAILED_TO_CATEGORY[detailedToken];
  }

  const primaryToken = normalizeToken(primary);

  if (primaryToken && PRIMARY_TO_CATEGORY[primaryToken]) {
    return PRIMARY_TO_CATEGORY[primaryToken];
  }

  return null;
}

export function derivePlaidCategoryPrior({
  primary,
  detailed,
  confidenceLevel,
}: {
  primary: string | null | undefined;
  detailed: string | null | undefined;
  confidenceLevel: string | null | undefined;
}): PlaidCategoryPrior | null {
  const primaryToken = normalizeToken(primary);
  const detailedToken = normalizeToken(detailed);

  if (!primaryToken && !detailedToken) {
    return null;
  }

  const level = normalizePlaidConfidenceLevel(confidenceLevel);

  return {
    primary: primaryToken,
    detailed: detailedToken,
    confidenceLevel: level,
    categoryId: mapPlaidCategoryToTaxonomy(primaryToken, detailedToken),
    weight: getPlaidConfidenceWeight(level),
  };
}
