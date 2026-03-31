import { buildNormalizedTransaction } from "@/lib/categorization/normalize";
import { classifyMovementType } from "@/lib/categorization/rules";
import type { TransactionDirection } from "@/lib/types/finance";

import type { CsvColumnMapping } from "@/lib/import/mapping";

export type CsvRow = Record<string, string>;

export type NormalizedImportEvent = {
  sourceTransactionId: string;
  sourceAccountId: string;
  accountName: string;
  postedAt: string;
  authorizedAt: string | null;
  descriptionRaw: string;
  merchantRaw: string;
  institutionCategory: string | null;
  pending: boolean;
  signedAmount: number;
  direction: TransactionDirection;
  transactionClass: ReturnType<typeof classifyMovementType>;
  rawPayloadJson: Record<string, unknown>;
  merchantNorm: string;
  descriptionNorm: string;
  keywordArray: string[];
};

function normalizeDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return date.toISOString().slice(0, 10);
}

function normalizeAmount(value: string) {
  const parsed = Number(value.replace(/[$,]/g, "").trim());

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid amount value: ${value}`);
  }

  return parsed;
}

function normalizeBoolean(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["true", "yes", "1", "pending"].includes(value.toLowerCase().trim());
}

export function normalizeCsvRow(
  row: CsvRow,
  mapping: CsvColumnMapping,
  index: number,
) {
  const descriptionRaw = row[mapping.description] ?? "";
  const merchantRaw = row[mapping.merchant ?? mapping.description] ?? descriptionRaw;
  const signedAmount = normalizeAmount(row[mapping.amount] ?? "");
  const postedAt = normalizeDate(row[mapping.postedAt] ?? "");
  const accountName = row[mapping.accountName ?? ""] || "Imported Account";
  const sourceAccountId =
    row[mapping.accountId ?? ""] ||
    accountName.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const pending = normalizeBoolean(
    mapping.pending ? row[mapping.pending] : undefined,
  );

  const normalized = buildNormalizedTransaction({
    merchantRaw,
    descriptionRaw,
  });

  return {
    sourceTransactionId: `csv-${postedAt}-${index + 1}`,
    sourceAccountId,
    accountName,
    postedAt,
    authorizedAt: null,
    descriptionRaw,
    merchantRaw,
    institutionCategory: mapping.institutionCategory
      ? row[mapping.institutionCategory] || null
      : null,
    pending,
    signedAmount,
    direction: signedAmount >= 0 ? "inflow" : "outflow",
    transactionClass: classifyMovementType(signedAmount, descriptionRaw),
    rawPayloadJson: row,
    merchantNorm: normalized.merchantNorm,
    descriptionNorm: normalized.descriptionNorm,
    keywordArray: normalized.keywordArray,
  } satisfies NormalizedImportEvent;
}
