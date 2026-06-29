import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceNumber } from "@/lib/queries/coerce";
import { deriveMonthlySummariesFromTransactions } from "@/lib/queries/finance-aggregates";
import {
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "@/lib/queries/user-scope";
import { sampleTransactions } from "@/lib/sample-data";
import {
  buildTimeFilterQueryParams,
  formatMonthLabel,
  getMonthRange,
  type TimeFilter,
} from "@/lib/time-filter";
import type { MonthlyFinanceSummary } from "@/lib/types/finance";

type RawMonthlyFinanceSummary = {
  month: string;
  income: unknown;
  spend: unknown;
  transaction_count: unknown;
};

function mapMonthlySummary(row: RawMonthlyFinanceSummary): MonthlyFinanceSummary {
  const range = getMonthRange(row.month);
  const income = coerceNumber(row.income);
  const spend = coerceNumber(row.spend);

  return {
    month: row.month,
    label: formatMonthLabel(row.month),
    from: range.from!,
    to: range.to!,
    income,
    spend,
    net: income - spend,
    transactionCount: coerceNumber(row.transaction_count),
  };
}

export async function getMonthlyFinanceSummaries(timeFilter?: TimeFilter) {
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
  const queryParams = {
    ...buildTimeFilterQueryParams(timeFilter ?? { preset: "all" }),
    userId,
  };
  const rows = userId
    ? await runBigQueryQuery<RawMonthlyFinanceSummary>(
        `
      SELECT
        FORMAT_DATE('%Y-%m', posted_at) AS month,
        SUM(IF(signed_amount > 0 AND transaction_class = 'income', signed_amount, 0)) AS income,
        SUM(
          IF(
            signed_amount < 0
            AND transaction_class NOT IN ('transfer', 'credit_payment'),
            ABS(signed_amount),
            0
          )
        ) AS spend,
        COUNT(*) AS transaction_count
      FROM (
        SELECT *
        FROM \`${projectId}.core_finance.fact_transaction_current\`
        WHERE ${transactionUserScopePredicate()}
        QUALIFY ${anonymousCsvDedupePredicate()}
          AND ${plaidCanonicalDedupePredicate()}
      )
      WHERE NOT pending
        AND (NOT @excludePlaid OR source_name != 'plaid')
      GROUP BY month
      ORDER BY month DESC
    `,
        queryParams,
      )
    : null;

  const summaries = rows
    ? rows.map(mapMonthlySummary)
    : deriveMonthlySummariesFromTransactions(
        timeFilter?.excludePlaid
          ? sampleTransactions.filter(
              (transaction) => transaction.sourceName !== "plaid",
            )
          : sampleTransactions,
      );

  return summaries;
}
