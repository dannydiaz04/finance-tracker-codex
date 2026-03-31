import "server-only";

import { runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleMerchantInsights } from "@/lib/sample-data";
import type { MerchantInsight } from "@/lib/types/finance";

export async function getMerchantInsights() {
  const rows = await runBigQueryQuery<MerchantInsight>(
    `
      SELECT
        merchant,
        amount AS spend,
        transactions,
        change_vs_prior AS trend,
        likely_recurring AS likelyRecurring
      FROM \`${process.env.BIGQUERY_PROJECT_ID ?? "project"}.mart_finance.merchant_spend_90d\`
      ORDER BY spend DESC
      LIMIT 20
    `,
  );

  return rows ?? sampleMerchantInsights;
}
