import "server-only";

import { runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleOverview } from "@/lib/sample-data";
import type { OverviewSnapshot } from "@/lib/types/finance";

export async function getOverviewSnapshot() {
  const rows = await runBigQueryQuery<OverviewSnapshot>(
    `
      SELECT *
      FROM \`${process.env.BIGQUERY_PROJECT_ID ?? "project"}.mart_finance.overview_snapshot\`
      LIMIT 1
    `,
  );

  return rows?.[0] ?? sampleOverview;
}
