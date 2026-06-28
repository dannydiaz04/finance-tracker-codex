import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNullableNumber, coerceNumber } from "@/lib/queries/coerce";
import { transactionUserScopePredicate } from "@/lib/queries/user-scope";
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
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = userId
    ? await runBigQueryQuery<Rule>(
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
      WHERE user_id = @userId
      ORDER BY priority DESC
    `,
        { userId },
      )
    : null;

  return rows ?? sampleRules;
}

export async function getLowConfidenceReviewItems(timeFilter?: TimeFilter) {
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = userId
    ? await runBigQueryQuery<ReviewQueueItem>(
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
      ORDER BY review_queue.confidence_score ASC
      LIMIT 25
    `,
        { ...buildTimeFilterQueryParams(timeFilter ?? { preset: "all" }), userId },
      )
    : null;

  return rows ?? filterByPostedAt(sampleReviewQueue, timeFilter ?? { preset: "all" });
}

export async function getRuleSuggestions() {
  const userId = await getCurrentUserId();
  const configuredProjectId = getBigQueryProjectId();
  const projectId = configuredProjectId ?? "project";
  let rows: RawRuleSuggestion[] | null = null;

  if (userId) {
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
          WHERE user_id = @userId
        )
        WHERE suggestion_rank = 1
          AND status = "pending"
        ORDER BY created_at DESC
        LIMIT 25
      `,
        { userId },
      );
    } catch {
      rows = null;
    }
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
  const userId = await getCurrentUserId();
  const configuredProjectId = getBigQueryProjectId();
  const projectId = configuredProjectId ?? "project";
  let rows: RawInternalMovementReconciliationItem[] | null = null;

  if (userId) {
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
        FROM \`${projectId}.ops_finance.internal_movement_reconciliation\` AS reconciliation
        INNER JOIN \`${projectId}.core_finance.fact_transaction_current\` AS current_txn
          ON current_txn.transaction_id = reconciliation.transaction_id
         AND COALESCE(current_txn.user_id, '') = COALESCE(reconciliation.user_id, '')
        WHERE reconciliation.match_status = "unmatched"
          AND ${transactionUserScopePredicate("current_txn")}
          AND (@from = '' OR reconciliation.posted_at >= DATE(@from))
          AND (@to = '' OR reconciliation.posted_at <= DATE(@to))
          AND (NOT @excludePlaid OR current_txn.source_name != 'plaid')
        ORDER BY reconciliation.posted_at DESC, ABS(reconciliation.signed_amount) DESC
        LIMIT 25
      `,
        { ...buildTimeFilterQueryParams(timeFilter ?? { preset: "all" }), userId },
      );
    } catch {
      rows = null;
    }
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

/**
 * Count how many of THIS user's transactions a candidate rule would match, using the
 * exact predicate fact_classification.sqlx applies (so the dry-run preview can't promise
 * matches the warehouse won't produce). Returns null when BigQuery isn't configured.
 */
export async function countRuleMatches(input: {
  userId: string;
  matchStrategy: Rule["matchStrategy"];
  matchValue: string;
}): Promise<number | null> {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    return null;
  }

  const predicate =
    input.matchStrategy === "merchant_exact"
      ? "LOWER(merchant_norm) = LOWER(@matchValue)"
      : input.matchStrategy === "description_regex"
        ? "REGEXP_CONTAINS(LOWER(description_norm), LOWER(@matchValue))"
        : "STRPOS(LOWER(merchant_norm), LOWER(@matchValue)) > 0";

  const rows = await runBigQueryQuery<{ matches: unknown }>(
    `
      SELECT COUNT(*) AS matches
      FROM \`${projectId}.core_finance.fact_transaction_current\`
      WHERE user_id = @userId
        AND ${predicate}
    `,
    { userId: input.userId, matchValue: input.matchValue },
  );

  return rows && rows[0] ? coerceNumber(rows[0].matches) : 0;
}

export type RawPendingSuggestion = {
  suggestion_id: string;
  transaction_id: string | null;
  category_id: string;
  category_label: string;
  match_strategy: string;
  match_value: string;
  rule_name: string;
  rule_description: string;
  source: string;
  note: string | null;
  created_at: string;
};

/** Latest pending suggestions for one transaction — used to supersede stale ones. */
export async function getPendingSuggestionsForTransaction(input: {
  userId: string;
  transactionId: string;
}): Promise<RawPendingSuggestion[]> {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    return [];
  }

  const rows = await runBigQueryQuery<RawPendingSuggestion>(
    `
      SELECT
        suggestion_id,
        transaction_id,
        category_id,
        category_label,
        match_strategy,
        match_value,
        rule_name,
        rule_description,
        source,
        note,
        CAST(created_at AS STRING) AS created_at
      FROM \`${projectId}.ops_finance.category_rule_suggestions\`
      WHERE user_id = @userId
      QUALIFY ROW_NUMBER() OVER (
        PARTITION BY suggestion_id
        ORDER BY updated_at DESC
      ) = 1
        AND transaction_id = @transactionId
        AND status = "pending"
    `,
    { userId: input.userId, transactionId: input.transactionId },
  );

  return rows ?? [];
}
