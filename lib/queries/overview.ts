import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleOverview } from "@/lib/sample-data";
import type { OverviewSnapshot } from "@/lib/types/finance";

export async function getOverviewSnapshot() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<OverviewSnapshot>(
    `
      SELECT *
      FROM \`${projectId}.mart_finance.overview_snapshot\`
      LIMIT 1
    `,
  );

  return rows?.[0] ?? sampleOverview;
}
