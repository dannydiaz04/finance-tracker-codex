import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNumber } from "@/lib/queries/coerce";
import { sampleCashflow } from "@/lib/sample-data";

type RawCashflowPoint = {
  date: unknown;
  inflow: unknown;
  outflow: unknown;
  net: unknown;
};

export async function getCashflowSeries() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<RawCashflowPoint>(
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

  return rows
    ? rows.map((row) => ({
        date: coerceDateString(row.date),
        inflow: coerceNumber(row.inflow),
        outflow: coerceNumber(row.outflow),
        net: coerceNumber(row.net),
      }))
    : sampleCashflow;
}
