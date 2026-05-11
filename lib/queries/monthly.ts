import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceNumber } from "@/lib/queries/coerce";
import { deriveMonthlySummariesFromTransactions } from "@/lib/queries/finance-aggregates";
import { sampleTransactions } from "@/lib/sample-data";
import { formatMonthLabel, getMonthRange } from "@/lib/time-filter";
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

export async function getMonthlyFinanceSummaries() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<RawMonthlyFinanceSummary>(
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
      FROM \`${projectId}.core_finance.fact_transaction_current\`
      WHERE NOT pending
      GROUP BY month
      ORDER BY month DESC
    `,
  );

  return rows
    ? rows.map(mapMonthlySummary)
    : deriveMonthlySummariesFromTransactions(sampleTransactions);
}
