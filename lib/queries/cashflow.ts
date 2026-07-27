import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNumber } from "@/lib/queries/coerce";
import { sampleCashflow } from "@/lib/sample-data";
import {
  buildTimeFilterQueryParams,
  filterByDate,
  type TimeFilter,
} from "@/lib/time-filter";
import {
  deriveCashflowByCategoryFromTransactions,
  deriveCashflowFromTransactions,
} from "@/lib/queries/finance-aggregates";
import { getTransactions } from "@/lib/queries/transactions";
import { scopeToTransactionFilters } from "@/lib/bigquery/params";
import type {
  CashflowCategoryBreakdown,
  CashflowCategorySlice,
} from "@/lib/types/finance";

type RawCashflowPoint = {
  date: unknown;
  inflow: unknown;
  outflow: unknown;
  net: unknown;
};

export type CashflowScope = {
  /** Restrict to these derived category ids; empty or omitted means every category. */
  categoryIds?: string[];
};

/**
 * The daily series is capped so the chart stays readable on multi-year scopes. Callers that
 * need scope-wide totals must use the category breakdown instead of summing the series.
 */
export const CASHFLOW_SERIES_DAY_LIMIT = 90;

function normalizeCategoryIds(categoryIds: string[] | undefined) {
  return (categoryIds ?? []).map((item) => item.trim()).filter(Boolean);
}

async function getScopedTransactions(scope: TimeFilter, categoryIds: string[]) {
  return getTransactions({
    ...scopeToTransactionFilters(scope),
    categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
  });
}

export async function getCashflowSeries(
  timeFilter?: TimeFilter,
  options?: CashflowScope,
) {
  const scope = timeFilter ?? { preset: "all" as const };
  const categoryIds = normalizeCategoryIds(options?.categoryIds);

  // daily_cashflow is pre-aggregated past source and category grain, so anything narrower
  // than a date range has to be rebuilt from the transactions themselves.
  if (scope.excludePlaid || categoryIds.length > 0) {
    const transactions = await getScopedTransactions(scope, categoryIds);
    return deriveCashflowFromTransactions(transactions).slice(
      0,
      CASHFLOW_SERIES_DAY_LIMIT,
    );
  }

  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
  const queryParams = { ...buildTimeFilterQueryParams(scope), userId };

  const rows = userId
    ? await runBigQueryQuery<RawCashflowPoint>(
        `
      SELECT
        date,
        inflow,
        outflow,
        net
      FROM \`${projectId}.mart_finance.daily_cashflow\`
      WHERE user_id = @userId
        AND (@from = '' OR date >= DATE(@from))
        AND (@to = '' OR date <= DATE(@to))
      ORDER BY date DESC
      LIMIT ${CASHFLOW_SERIES_DAY_LIMIT}
    `,
        queryParams,
      )
    : null;

  return rows
    ? rows.map((row) => ({
        date: coerceDateString(row.date),
        inflow: coerceNumber(row.inflow),
        outflow: coerceNumber(row.outflow),
        net: coerceNumber(row.net),
      }))
    : filterByDate(sampleCashflow, scope);
}

function sumSlices(slices: CashflowCategorySlice[]) {
  const inflow = slices.reduce((sum, slice) => sum + slice.inflow, 0);
  const outflow = slices.reduce((sum, slice) => sum + slice.outflow, 0);

  return {
    inflow,
    outflow,
    net: inflow - outflow,
    transactionCount: slices.reduce(
      (sum, slice) => sum + slice.transactionCount,
      0,
    ),
  };
}

/**
 * Cash flow split by category for the same time scope the rest of the page uses. Reads the
 * transaction grain once and derives twice: the unfiltered pass drives the category picker so
 * unselected categories stay listable, the filtered pass drives the chart with shares
 * renormalized to the selection.
 */
export async function getCashflowCategoryBreakdown(
  timeFilter?: TimeFilter,
  options?: CashflowScope,
): Promise<CashflowCategoryBreakdown> {
  const scope = timeFilter ?? { preset: "all" as const };
  const categoryIds = normalizeCategoryIds(options?.categoryIds);
  const transactions = await getScopedTransactions(scope, []);
  const optionSlices = deriveCashflowByCategoryFromTransactions(transactions);

  if (categoryIds.length === 0) {
    return {
      slices: optionSlices,
      options: optionSlices,
      totals: sumSlices(optionSlices),
    };
  }

  const selected = new Set(categoryIds);
  const slices = deriveCashflowByCategoryFromTransactions(
    transactions.filter((transaction) =>
      selected.has(transaction.derivedCategoryId),
    ),
  );

  return { slices, options: optionSlices, totals: sumSlices(slices) };
}
