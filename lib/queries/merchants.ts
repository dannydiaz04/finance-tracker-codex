import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceNumber } from "@/lib/queries/coerce";
import { sampleMerchantInsights } from "@/lib/sample-data";
import type { MerchantInsight } from "@/lib/types/finance";

type RawMerchantInsight = Omit<
  MerchantInsight,
  "spend" | "transactions" | "trend"
> & {
  spend: unknown;
  transactions: unknown;
  trend: unknown;
};

export async function getMerchantInsights() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<RawMerchantInsight>(
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

  return rows
    ? rows.map((row) => ({
        ...row,
        spend: coerceNumber(row.spend),
        transactions: coerceNumber(row.transactions),
        trend: coerceNumber(row.trend),
      }))
    : sampleMerchantInsights;
}
