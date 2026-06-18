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

type RawCashflowPoint = {
  date: unknown;
  inflow: unknown;
  outflow: unknown;
  net: unknown;
};

export async function getCashflowSeries(timeFilter?: TimeFilter) {
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
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
        { ...buildTimeFilterQueryParams(timeFilter ?? { preset: "all" }), userId },
      )
    : null;

  return rows
    ? rows.map((row) => ({
        date: coerceDateString(row.date),
        inflow: coerceNumber(row.inflow),
        outflow: coerceNumber(row.outflow),
        net: coerceNumber(row.net),
      }))
    : filterByDate(sampleCashflow, timeFilter ?? { preset: "all" });
}
