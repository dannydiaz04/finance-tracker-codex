import "server-only";

import { runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleCashflow } from "@/lib/sample-data";
import type { CashflowPoint } from "@/lib/types/finance";

export async function getCashflowSeries() {
  const rows = await runBigQueryQuery<CashflowPoint>(
    `
      SELECT
        date,
        inflow,
        outflow,
        net
      FROM \`${process.env.BIGQUERY_PROJECT_ID ?? "project"}.mart_finance.daily_cashflow\`
      ORDER BY date DESC
      LIMIT 90
    `,
  );

  return rows ?? sampleCashflow;
}
