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
  const accountIds = filters.accountIds ?? [];
  const categoryIds = filters.categoryIds ?? [];

  return {
    query: filters.query ?? "",
    accountIds: accountIds.length > 0 ? accountIds : [""],
    hasAccountIds: accountIds.length > 0,
    categoryIds: categoryIds.length > 0 ? categoryIds : [""],
    hasCategoryIds: categoryIds.length > 0,
    merchant: filters.merchant ?? "",
    direction:
      filters.direction && filters.direction !== "all" ? filters.direction : "",
    transactionClass:
      filters.transactionClass && filters.transactionClass !== "all"
        ? filters.transactionClass
        : "",
    pending: filters.pending && filters.pending !== "all" ? filters.pending : "",
    from: filters.from ?? "",
    to: filters.to ?? "",
    minAmount: filters.minAmount ?? -1,
    maxAmount: filters.maxAmount ?? -1,
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
