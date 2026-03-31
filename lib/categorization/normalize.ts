import type { Transaction } from "@/lib/types/finance";

const noisePatterns = [
  /\bpos debit\b/g,
  /\bcheckcard\b/g,
  /\bvisa purchase\b/g,
  /\bmc purchase\b/g,
  /\bdebit card purchase\b/g,
  /\bsq \*/g,
  /\b\d{3,}\b/g,
];

export function normalizeDescription(value: string) {
  return noisePatterns
    .reduce(
      (normalized, pattern) => normalized.replace(pattern, " "),
      value.toLowerCase(),
    )
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function deriveKeywordArray(value: string) {
  return normalizeDescription(value)
    .split(" ")
    .filter((keyword) => keyword.length > 2);
}

export function normalizeMerchant(value: string) {
  return normalizeDescription(value)
    .replace(/\binc\b/g, "")
    .replace(/\bllc\b/g, "")
    .replace(/\bco\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildNormalizedTransaction<
  T extends Pick<Transaction, "merchantRaw" | "descriptionRaw">,
>(transaction: T) {
  return {
    merchantNorm: normalizeMerchant(transaction.merchantRaw),
    descriptionNorm: normalizeDescription(transaction.descriptionRaw),
    keywordArray: deriveKeywordArray(
      `${transaction.merchantRaw} ${transaction.descriptionRaw}`,
    ),
  };
}
