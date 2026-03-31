import type { TransactionFilters, TransactionSearchSuggestion } from "@/lib/types/finance";

type SearchValue = string | string[] | undefined;

export type SearchParamsInput = Record<string, SearchValue>;

function getSingleValue(value: SearchValue) {
  return Array.isArray(value) ? value[0] : value;
}

function getStringArray(value: SearchValue) {
  if (!value) {
    return undefined;
  }

  const list = Array.isArray(value) ? value : value.split(",");
  const normalized = list.map((item) => item.trim()).filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function getNumberValue(value: SearchValue) {
  const normalized = getSingleValue(value);

  if (!normalized) {
    return undefined;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeTransactionFilters(
  searchParams: SearchParamsInput,
): TransactionFilters {
  return {
    query: getSingleValue(searchParams.query)?.trim() || undefined,
    accountIds: getStringArray(searchParams.accountIds),
    categoryIds: getStringArray(searchParams.categoryIds),
    merchant: getSingleValue(searchParams.merchant)?.trim() || undefined,
    direction:
      (getSingleValue(searchParams.direction) as TransactionFilters["direction"]) ??
      "all",
    transactionClass:
      (getSingleValue(
        searchParams.transactionClass,
      ) as TransactionFilters["transactionClass"]) ?? "all",
    pending:
      (getSingleValue(searchParams.pending) as TransactionFilters["pending"]) ??
      "all",
    from: getSingleValue(searchParams.from) || undefined,
    to: getSingleValue(searchParams.to) || undefined,
    minAmount: getNumberValue(searchParams.minAmount),
    maxAmount: getNumberValue(searchParams.maxAmount),
    selectedId: getSingleValue(searchParams.selectedId) || undefined,
  };
}

export function buildTransactionQueryParams(filters: TransactionFilters) {
  return {
    query: filters.query ?? null,
    accountIds: filters.accountIds ?? [],
    categoryIds: filters.categoryIds ?? [],
    merchant: filters.merchant ?? null,
    direction:
      filters.direction && filters.direction !== "all" ? filters.direction : null,
    transactionClass:
      filters.transactionClass && filters.transactionClass !== "all"
        ? filters.transactionClass
        : null,
    pending:
      filters.pending && filters.pending !== "all" ? filters.pending : null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    minAmount: filters.minAmount ?? null,
    maxAmount: filters.maxAmount ?? null,
  };
}

export function uniqueSearchSuggestions(
  suggestions: TransactionSearchSuggestion[],
) {
  return Array.from(
    new Map(
      suggestions.map((suggestion) => [
        `${suggestion.type}:${suggestion.label.toLowerCase()}`,
        suggestion,
      ]),
    ).values(),
  );
}
