import "server-only";

import { scopeToTransactionFilters } from "@/lib/bigquery/params";
import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNumber } from "@/lib/queries/coerce";
import { deriveCategoryInsightsFromTransactions } from "@/lib/queries/finance-aggregates";
import { getTransactions } from "@/lib/queries/transactions";
import { transactionUserScopePredicate } from "@/lib/queries/user-scope";
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
  const transactions = await getTransactions(scopeToTransactionFilters(timeFilter));
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
        review_queue.transaction_id AS transactionId,
        review_queue.merchant,
        review_queue.description,
        review_queue.amount,
        review_queue.posted_at AS postedAt,
        review_queue.suggested_category AS suggestedCategory,
        review_queue.current_category_id AS currentCategoryId,
        review_queue.merchant_norm AS merchantNorm,
        review_queue.confidence_score AS confidenceScore,
        review_queue.reason
      FROM \`${projectId}.ops_finance.review_queue\` AS review_queue
      INNER JOIN \`${projectId}.core_finance.fact_transaction_current\` AS current_txn
        ON current_txn.transaction_id = review_queue.transaction_id
       AND COALESCE(current_txn.user_id, '') = COALESCE(review_queue.user_id, '')
      WHERE ${transactionUserScopePredicate("current_txn")}
        AND (@from = '' OR review_queue.posted_at >= DATE(@from))
        AND (@to = '' OR review_queue.posted_at <= DATE(@to))
        AND (NOT @excludePlaid OR current_txn.source_name != 'plaid')
      ORDER BY review_queue.confidence_score ASC, review_queue.posted_at DESC
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
