import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNumber } from "@/lib/queries/coerce";
import { sampleCategoryInsights, sampleReviewQueue } from "@/lib/sample-data";
import type { CategoryInsight, ReviewQueueItem } from "@/lib/types/finance";

type RawCategoryInsight = Omit<
  CategoryInsight,
  "amount" | "share" | "transactionCount" | "trend"
> & {
  amount: unknown;
  share: unknown;
  transactionCount: unknown;
  trend: unknown;
};

type RawReviewQueueItem = Omit<
  ReviewQueueItem,
  "amount" | "postedAt" | "confidenceScore"
> & {
  amount: unknown;
  postedAt: unknown;
  confidenceScore: unknown;
};

export async function getCategoryInsights() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<RawCategoryInsight>(
    `
      SELECT
        category_id AS categoryId,
        label,
        amount,
        share,
        transaction_count AS transactionCount,
        trend
      FROM \`${projectId}.mart_finance.category_spend_daily\`
      ORDER BY amount DESC
      LIMIT 20
    `,
  );

  return rows
    ? rows.map((row) => ({
        ...row,
        amount: coerceNumber(row.amount),
        share: coerceNumber(row.share),
        transactionCount: coerceNumber(row.transactionCount),
        trend: coerceNumber(row.trend),
      }))
    : sampleCategoryInsights;
}

export async function getReviewQueue() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<RawReviewQueueItem>(
    `
      SELECT
        transaction_id AS transactionId,
        merchant,
        description,
        amount,
        posted_at AS postedAt,
        suggested_category AS suggestedCategory,
        confidence_score AS confidenceScore,
        reason
      FROM \`${projectId}.ops_finance.review_queue\`
      ORDER BY confidence_score ASC, posted_at DESC
      LIMIT 50
    `,
  );

  return rows
    ? rows.map((row) => ({
        ...row,
        amount: coerceNumber(row.amount),
        postedAt: coerceDateString(row.postedAt),
        confidenceScore: coerceNumber(row.confidenceScore),
      }))
    : sampleReviewQueue;
}
