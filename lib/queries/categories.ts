import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNumber } from "@/lib/queries/coerce";
import { deriveCategoryInsightsFromTransactions } from "@/lib/queries/finance-aggregates";
import { getTransactions } from "@/lib/queries/transactions";
import { sampleReviewQueue } from "@/lib/sample-data";
import {
  buildTimeFilterQueryParams,
  filterByPostedAt,
  type TimeFilter,
} from "@/lib/time-filter";
import type { ReviewQueueItem } from "@/lib/types/finance";

type RawReviewQueueItem = Omit<
  ReviewQueueItem,
  "amount" | "postedAt" | "confidenceScore"
> & {
  amount: unknown;
  postedAt: unknown;
  confidenceScore: unknown;
};

export async function getCategoryInsights(timeFilter?: TimeFilter) {
  const transactions = await getTransactions({
    from: timeFilter?.from,
    to: timeFilter?.to,
  });
  return deriveCategoryInsightsFromTransactions(transactions).slice(
    0,
    20,
  );
}

export async function getReviewQueue(timeFilter?: TimeFilter) {
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = userId
    ? await runBigQueryQuery<RawReviewQueueItem>(
        `
      SELECT
        transaction_id AS transactionId,
        merchant,
        description,
        amount,
        posted_at AS postedAt,
        suggested_category AS suggestedCategory,
        current_category_id AS currentCategoryId,
        merchant_norm AS merchantNorm,
        confidence_score AS confidenceScore,
        reason
      FROM \`${projectId}.ops_finance.review_queue\`
      WHERE user_id = @userId
        AND (@from = '' OR posted_at >= DATE(@from))
        AND (@to = '' OR posted_at <= DATE(@to))
      ORDER BY confidence_score ASC, posted_at DESC
      LIMIT 50
    `,
        { ...buildTimeFilterQueryParams(timeFilter ?? { preset: "all" }), userId },
      )
    : null;

  return rows
    ? rows.map((row) => ({
        ...row,
        amount: coerceNumber(row.amount),
        postedAt: coerceDateString(row.postedAt),
        confidenceScore: coerceNumber(row.confidenceScore),
      }))
    : filterByPostedAt(sampleReviewQueue, timeFilter ?? { preset: "all" });
}
