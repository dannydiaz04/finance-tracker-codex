import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNullableNumber, coerceNumber } from "@/lib/queries/coerce";
import {
  sampleInternalMovementReconciliationItems,
  sampleReviewQueue,
  sampleRuleSuggestions,
  sampleRules,
} from "@/lib/sample-data";
import {
  buildTimeFilterQueryParams,
  filterByPostedAt,
  type TimeFilter,
} from "@/lib/time-filter";
import type {
  InternalMovementReconciliationItem,
  ReviewQueueItem,
  Rule,
  RuleSuggestion,
} from "@/lib/types/finance";

type RawRuleSuggestion = Omit<
  RuleSuggestion,
  "createdAt" | "updatedAt" | "reviewedAt"
> & {
  createdAt: unknown;
  updatedAt: unknown;
  reviewedAt: unknown;
};

type RawInternalMovementReconciliationItem = Omit<
  InternalMovementReconciliationItem,
  "postedAt" | "signedAmount" | "dayDelta" | "amountDelta"
> & {
  postedAt: unknown;
  signedAmount: unknown;
  dayDelta: unknown;
  amountDelta: unknown;
};

export async function getRules() {
  const projectId = getBigQueryProjectId() ?? "project";
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
      FROM \`${projectId}.ops_finance.category_rules\`
      ORDER BY priority DESC
    `,
  );

  return rows ?? sampleRules;
}

export async function getLowConfidenceReviewItems(timeFilter?: TimeFilter) {
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
      WHERE (@from = '' OR posted_at >= DATE(@from))
        AND (@to = '' OR posted_at <= DATE(@to))
      ORDER BY confidence_score ASC
      LIMIT 25
    `,
    buildTimeFilterQueryParams(timeFilter ?? { preset: "all" }),
  );

  return rows ?? filterByPostedAt(sampleReviewQueue, timeFilter ?? { preset: "all" });
}

export async function getRuleSuggestions() {
  const configuredProjectId = getBigQueryProjectId();
  const projectId = configuredProjectId ?? "project";
  let rows: RawRuleSuggestion[] | null = null;

  try {
    rows = await runBigQueryQuery<RawRuleSuggestion>(
      `
        SELECT
          suggestion_id AS suggestionId,
          transaction_id AS transactionId,
          category_id AS categoryId,
          category_label AS categoryLabel,
          match_strategy AS matchStrategy,
          match_value AS matchValue,
          rule_name AS ruleName,
          rule_description AS ruleDescription,
          source,
          status,
          note,
          created_at AS createdAt,
          updated_at AS updatedAt,
          reviewed_at AS reviewedAt
        FROM (
          SELECT
            *,
            ROW_NUMBER() OVER (
              PARTITION BY suggestion_id
              ORDER BY updated_at DESC
            ) AS suggestion_rank
          FROM \`${projectId}.ops_finance.category_rule_suggestions\`
        )
        WHERE suggestion_rank = 1
          AND status = "pending"
        ORDER BY created_at DESC
        LIMIT 25
      `,
    );
  } catch {
    rows = null;
  }

  if (rows) {
    return rows.map((row) => ({
      ...row,
      createdAt: coerceDateString(row.createdAt),
      updatedAt: coerceDateString(row.updatedAt),
      reviewedAt: row.reviewedAt ? coerceDateString(row.reviewedAt) : null,
    }));
  }

  return configuredProjectId ? [] : sampleRuleSuggestions;
}

export async function getInternalMovementReconciliationItems(
  timeFilter?: TimeFilter,
) {
  const configuredProjectId = getBigQueryProjectId();
  const projectId = configuredProjectId ?? "project";
  let rows: RawInternalMovementReconciliationItem[] | null = null;

  try {
    rows = await runBigQueryQuery<RawInternalMovementReconciliationItem>(
      `
        SELECT
          transaction_id AS transactionId,
          counterpart_transaction_id AS counterpartTransactionId,
          account_name AS accountName,
          transaction_class AS transactionClass,
          posted_at AS postedAt,
          signed_amount AS signedAmount,
          merchant_raw AS merchant,
          description_raw AS description,
          match_status AS matchStatus,
          day_delta AS dayDelta,
          amount_delta AS amountDelta,
          reconciliation_group_id AS reconciliationGroupId
        FROM \`${projectId}.ops_finance.internal_movement_reconciliation\`
        WHERE match_status = "unmatched"
          AND (@from = '' OR posted_at >= DATE(@from))
          AND (@to = '' OR posted_at <= DATE(@to))
        ORDER BY posted_at DESC, ABS(signed_amount) DESC
        LIMIT 25
      `,
      buildTimeFilterQueryParams(timeFilter ?? { preset: "all" }),
    );
  } catch {
    rows = null;
  }

  if (rows) {
    return rows.map((row) => ({
      ...row,
      postedAt: coerceDateString(row.postedAt),
      signedAmount: coerceNumber(row.signedAmount),
      dayDelta: coerceNullableNumber(row.dayDelta),
      amountDelta: coerceNullableNumber(row.amountDelta),
    }));
  }

  return configuredProjectId
    ? []
    : filterByPostedAt(
        sampleInternalMovementReconciliationItems,
        timeFilter ?? { preset: "all" },
      ).filter((item) => item.matchStatus === "unmatched");
}
