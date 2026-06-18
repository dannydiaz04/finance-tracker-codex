import type { AccountBase, Transaction } from "plaid";

import { buildNormalizedTransaction } from "../categorization/normalize.ts";
import { classifyMovementType } from "../categorization/rules.ts";
import type { NormalizedImportEvent } from "../import/normalize.ts";

function toIsoTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  // Plaid sends either a full datetime ("2026-01-02T12:00:00Z") or a bare date
  // ("2026-01-02"). Normalize both to an ISO timestamp at UTC.
  const parsed = new Date(/T/.test(value) ? value : `${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function resolveInstitutionCategory(transaction: Transaction) {
  if (transaction.personal_finance_category?.primary) {
    return transaction.personal_finance_category.primary;
  }

  const legacyCategory = transaction.category ?? [];
  return legacyCategory.length > 0 ? legacyCategory[legacyCategory.length - 1] : null;
}

export function normalizePlaidTransaction(
  transaction: Transaction,
  account?: AccountBase,
  institutionName?: string | null,
): NormalizedImportEvent {
  const accountName =
    account?.name ||
    account?.official_name ||
    institutionName ||
    transaction.account_id;
  // Plaid sign convention is inverted relative to the warehouse: Plaid reports
  // positive amounts when money leaves the account. The warehouse treats
  // positive as inflow, so we flip the sign here.
  const signedAmount = -transaction.amount;
  const descriptionRaw = transaction.name ?? "";
  const merchantRaw = transaction.merchant_name || descriptionRaw;
  const institutionCategory = resolveInstitutionCategory(transaction);
  const accountType = account?.type ? String(account.type) : "";
  const accountSubtype = account?.subtype ? String(account.subtype) : "";
  const transactionType = transaction.payment_channel ?? "";
  const normalized = buildNormalizedTransaction({ merchantRaw, descriptionRaw });

  return {
    sourceTransactionId: transaction.transaction_id,
    sourceAccountId: transaction.account_id,
    accountName,
    accountMask: account?.mask ?? "",
    accountType,
    accountSubtype,
    transactionType,
    currencyCode: transaction.iso_currency_code ?? "USD",
    postedAt: transaction.date,
    authorizedAt:
      toIsoTimestamp(transaction.authorized_datetime) ??
      toIsoTimestamp(transaction.datetime) ??
      toIsoTimestamp(transaction.authorized_date),
    descriptionRaw,
    merchantRaw,
    institutionCategory,
    pending: Boolean(transaction.pending),
    signedAmount,
    direction: signedAmount >= 0 ? "inflow" : "outflow",
    transactionClass: classifyMovementType(signedAmount, descriptionRaw, {
      accountType,
      accountSubtype,
      institutionCategory,
      merchantRaw,
      transactionType,
    }),
    rawPayloadJson: transaction as unknown as Record<string, unknown>,
    merchantNorm: normalized.merchantNorm,
    descriptionNorm: normalized.descriptionNorm,
    keywordArray: normalized.keywordArray,
  } satisfies NormalizedImportEvent;
}
