import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleMerchantInsights } from "@/lib/sample-data";
import type { MerchantInsight } from "@/lib/types/finance";

export async function getMerchantInsights() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<MerchantInsight>(
    `
      SELECT
        merchant,
        amount AS spend,
        transactions,
        change_vs_prior AS trend,
        likely_recurring AS likelyRecurring
      FROM \`${projectId}.mart_finance.merchant_spend_90d\`
      ORDER BY spend DESC
      LIMIT 20
    `,
  );

  return rows ?? sampleMerchantInsights;
}
