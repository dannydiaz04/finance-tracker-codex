import "server-only";

import { runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleReviewQueue, sampleRules } from "@/lib/sample-data";
import type { ReviewQueueItem, Rule } from "@/lib/types/finance";

export async function getRules() {
  const rows = await runBigQueryQuery<Rule>(
    `
      SELECT
        rule_id AS id,
        name,
        description,
        priority,
        enabled,
        category_id AS categoryId,
        category_label AS categoryLabel,
        match_strategy AS matchStrategy,
        match_value AS matchValue,
        confidence_boost AS confidenceBoost,
        hit_rate AS hitRate,
        last_matched_at AS lastMatchedAt
      FROM \`${process.env.BIGQUERY_PROJECT_ID ?? "project"}.ops_finance.category_rules\`
      ORDER BY priority DESC
    `,
  );

  return rows ?? sampleRules;
}

export async function getLowConfidenceReviewItems() {
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
      FROM \`${process.env.BIGQUERY_PROJECT_ID ?? "project"}.ops_finance.review_queue\`
      ORDER BY confidence_score ASC
      LIMIT 25
    `,
  );

  return rows ?? sampleReviewQueue;
}
