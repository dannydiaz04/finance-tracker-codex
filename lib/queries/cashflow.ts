import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNumber } from "@/lib/queries/coerce";
import { sampleCashflow, sampleTransactions } from "@/lib/sample-data";
import {
  buildTimeFilterQueryParams,
  filterByDate,
  type TimeFilter,
} from "@/lib/time-filter";
import { deriveCashflowFromTransactions } from "@/lib/queries/finance-aggregates";
import { getTransactions } from "@/lib/queries/transactions";
import { scopeToTransactionFilters } from "@/lib/bigquery/params";

type RawCashflowPoint = {
  date: unknown;
  inflow: unknown;
  outflow: unknown;
  net: unknown;
};

export async function getCashflowSeries(timeFilter?: TimeFilter) {
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
  const scope = timeFilter ?? { preset: "all" as const };
  const queryParams = { ...buildTimeFilterQueryParams(scope), userId };

  if (scope.excludePlaid) {
    if (userId) {
      const transactions = await getTransactions(scopeToTransactionFilters(scope));
      return deriveCashflowFromTransactions(transactions).slice(0, 90);
    }

    return filterByDate(
      deriveCashflowFromTransactions(
        sampleTransactions.filter(
          (transaction) => transaction.sourceName !== "plaid",
        ),
      ),
      scope,
    ).slice(0, 90);
  }

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
      LIMIT 90
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
