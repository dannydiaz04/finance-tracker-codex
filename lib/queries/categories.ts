import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleCategoryInsights, sampleReviewQueue } from "@/lib/sample-data";
import type { CategoryInsight, ReviewQueueItem } from "@/lib/types/finance";

export async function getCategoryInsights() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<CategoryInsight>(
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

  return rows ?? sampleCategoryInsights;
}

export async function getReviewQueue() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<ReviewQueueItem>(
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

  return rows ?? sampleReviewQueue;
}
