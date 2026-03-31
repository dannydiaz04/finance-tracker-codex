import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleCashflow } from "@/lib/sample-data";
import type { CashflowPoint } from "@/lib/types/finance";

export async function getCashflowSeries() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<CashflowPoint>(
    `
      SELECT
        date,
        inflow,
        outflow,
        net
      FROM \`${projectId}.mart_finance.daily_cashflow\`
      ORDER BY date DESC
      LIMIT 90
    `,
  );

  return rows ?? sampleCashflow;
}
