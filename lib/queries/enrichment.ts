import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceNumber } from "@/lib/queries/coerce";
import { sampleTransactions } from "@/lib/sample-data";

// Mirrors the eligibility used by ops_finance.ai_enrichment_queue: a posted,
// non-transfer row that is uncategorized, only has an institution-provided
// category, or is below the confidence bar.
export const LOW_CONFIDENCE_THRESHOLD = 0.85;

const QUEUE_EXCLUDED_CLASSES = new Set(["transfer", "credit_payment"]);

export type LowConfidenceSummary = {
  count: number;
  threshold: number;
  source: "warehouse" | "sample";
};

function countSampleLowConfidence() {
  return sampleTransactions.filter(
    (transaction) =>
      !transaction.pending &&
      !QUEUE_EXCLUDED_CLASSES.has(transaction.transactionClass) &&
      (transaction.derivedCategoryId === "uncategorized" ||
        transaction.classificationSource === "institution_category" ||
        transaction.confidenceScore < LOW_CONFIDENCE_THRESHOLD),
  ).length;
}

// Count of rows currently waiting for AI fallback (queued and not yet enriched
// with an accepted / needs_review suggestion) for the current user.
export async function getLowConfidenceSummary(): Promise<LowConfidenceSummary> {
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId();

  if (userId && projectId) {
    const rows = await runBigQueryQuery<{ count: unknown }>(
      `
        SELECT COUNT(*) AS count
        FROM \`${projectId}.ops_finance.ai_enrichment_queue\` AS q
        WHERE q.user_id = @userId
          AND NOT EXISTS (
            SELECT 1
            FROM \`${projectId}.ops_finance.ai_enrichment_results\` AS results
            WHERE results.transaction_id = q.transaction_id
              AND results.status IN ("accepted", "needs_review")
          )
      `,
      { userId },
    );

    if (rows) {
      return {
        count: coerceNumber(rows[0]?.count),
        threshold: LOW_CONFIDENCE_THRESHOLD,
        source: "warehouse",
      };
    }
  }

  return {
    count: countSampleLowConfidence(),
    threshold: LOW_CONFIDENCE_THRESHOLD,
    source: "sample",
  };
}
