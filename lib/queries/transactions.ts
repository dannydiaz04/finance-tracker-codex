import "server-only";

import { normalizeDescription } from "@/lib/categorization/normalize";
import { getCurrentUserId } from "@/lib/auth/session";
import {
  buildTransactionQueryParams,
  scopeToTransactionFilters,
  uniqueSearchSuggestions,
} from "@/lib/bigquery/params";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceDateString, coerceNumber } from "@/lib/queries/coerce";
import {
  sampleTransactionDetails,
  sampleTransactions,
} from "@/lib/sample-data";
import type { TimeFilter } from "@/lib/time-filter";
import {
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "@/lib/queries/user-scope";
import type {
  Transaction,
  TransactionDetail,
  TransactionFilters,
  TransactionSearchSuggestion,
} from "@/lib/types/finance";

type RawClassificationHistoryItem = {
  timestamp: unknown;
  source: Transaction["classificationSource"];
  confidence_score: unknown;
  category_id: string;
  category_label: string;
  note: string;
};

type RawTransaction = Omit<
  Transaction,
  "authorizedAt" | "postedAt" | "signedAmount" | "confidenceScore" | "classificationHistory"
> & {
  authorizedAt: unknown;
  postedAt: unknown;
  signedAmount: unknown;
  confidenceScore: unknown;
  classificationHistory: RawClassificationHistoryItem[];
};

function matchesFilters(transaction: Transaction, filters: TransactionFilters) {
  const search = normalizeDescription(filters.query ?? "");
  const haystack = normalizeDescription(
    [
      transaction.merchantRaw,
      transaction.merchantNorm,
      transaction.descriptionRaw,
      transaction.descriptionNorm,
      transaction.notes.join(" "),
      transaction.keywordArray.join(" "),
    ].join(" "),
  );

  if (search && !haystack.includes(search)) {
    return false;
  }

  if (
    filters.accountIds?.length &&
    !filters.accountIds.includes(transaction.accountId)
  ) {
    return false;
  }

  if (
    filters.categoryGroups?.length &&
    !filters.categoryGroups.includes(transaction.categoryGroup)
  ) {
    return false;
  }

  if (
    filters.categoryIds?.length &&
    !filters.categoryIds.includes(transaction.derivedCategoryId)
  ) {
    return false;
  }

  if (
    filters.merchant &&
    !normalizeDescription(transaction.merchantRaw).includes(
      normalizeDescription(filters.merchant),
    )
  ) {
    return false;
  }

  if (filters.direction && filters.direction !== "all") {
    if (transaction.direction !== filters.direction) {
      return false;
    }
  }

  if (filters.transactionClass && filters.transactionClass !== "all") {
    if (transaction.transactionClass !== filters.transactionClass) {
      return false;
    }
  }

  if (filters.pending && filters.pending !== "all") {
    if (filters.pending === "pending" && !transaction.pending) {
      return false;
    }

    if (filters.pending === "posted" && transaction.pending) {
      return false;
    }
  }

  if (filters.from && transaction.postedAt < filters.from) {
    return false;
  }

  if (filters.to && transaction.postedAt > filters.to) {
    return false;
  }

  if (filters.excludePlaid && transaction.sourceName === "plaid") {
    return false;
  }

  if (
    typeof filters.minAmount === "number" &&
    Math.abs(transaction.signedAmount) < filters.minAmount
  ) {
    return false;
  }

  if (
    typeof filters.maxAmount === "number" &&
    Math.abs(transaction.signedAmount) > filters.maxAmount
  ) {
    return false;
  }

  return true;
}

const projectId = getBigQueryProjectId() ?? "project";

const transactionSelectFields = `
  transaction_id AS transactionId,
  source_transaction_id AS sourceTransactionId,
  canonical_group_id AS canonicalGroupId,
  account_id AS accountId,
  account_name AS accountName,
  source_name AS sourceName,
  account_type AS accountType,
  authorized_at AS authorizedAt,
  posted_at AS postedAt,
  pending,
  direction,
  transaction_class AS transactionClass,
  signed_amount AS signedAmount,
  merchant_raw AS merchantRaw,
  merchant_norm AS merchantNorm,
  description_raw AS descriptionRaw,
  description_norm AS descriptionNorm,
  institution_category AS institutionCategory,
  derived_category_id AS derivedCategoryId,
  category_group AS categoryGroup,
  category_label AS categoryLabel,
  subcategory_id AS subcategoryId,
  confidence_score AS confidenceScore,
  classification_source AS classificationSource,
  rule_id AS ruleId,
  is_transfer AS isTransfer,
  is_duplicate AS isDuplicate,
  notes,
  keyword_array AS keywordArray,
  raw_payload_json AS rawPayloadJson,
  classification_history AS classificationHistory
`;

// The canonical fact is batch-built, while manual overrides are written immediately.
// Overlay each user's latest override at read time so saved category changes are visible
// without waiting for the next Dataform refresh.
const transactionCurrentReadQuery = `
  WITH scoped_transactions AS (
    SELECT *
    FROM \`${projectId}.core_finance.fact_transaction_current\`
    WHERE ${transactionUserScopePredicate()}
    QUALIFY ${anonymousCsvDedupePredicate()}
      AND ${plaidCanonicalDedupePredicate()}
  ),
  latest_overrides AS (
    SELECT
      transaction_id,
      category_id
    FROM \`${projectId}.ops_finance.manual_overrides\`
    WHERE user_id = @userId
    QUALIFY ROW_NUMBER() OVER (
      PARTITION BY transaction_id
      ORDER BY updated_at DESC, category_id DESC
    ) = 1
  ),
  resolved_transactions AS (
    SELECT
      scoped_transactions.*,
      latest_overrides.category_id AS override_category_id,
      COALESCE(
        latest_overrides.category_id,
        scoped_transactions.derived_category_id
      ) AS resolved_category_id
    FROM scoped_transactions
    LEFT JOIN latest_overrides
      ON latest_overrides.transaction_id = scoped_transactions.transaction_id
  )
  SELECT
    resolved_transactions.* EXCEPT (
      override_category_id,
      resolved_category_id
    ) REPLACE (
      resolved_transactions.resolved_category_id AS derived_category_id,
      COALESCE(
        effective_user_category.label,
        effective_seed_category.label,
        resolved_transactions.category_label
      ) AS category_label,
      COALESCE(
        effective_user_category.category_l2,
        effective_seed_category.category_l2,
        resolved_transactions.subcategory_id
      ) AS subcategory_id,
      IF(
        resolved_transactions.override_category_id IS NOT NULL,
        CAST(1 AS FLOAT64),
        resolved_transactions.confidence_score
      ) AS confidence_score,
      IF(
        resolved_transactions.override_category_id IS NOT NULL,
        "manual_override",
        resolved_transactions.classification_source
      ) AS classification_source
    ),
    COALESCE(
      effective_user_category.category_l1,
      effective_seed_category.category_l1,
      ""
    ) AS category_group
  FROM resolved_transactions
  LEFT JOIN \`${projectId}.core_finance.dim_category_effective\` AS effective_user_category
    ON effective_user_category.user_id = @userId
   AND effective_user_category.category_id = resolved_transactions.resolved_category_id
  LEFT JOIN \`${projectId}.core_finance.dim_category_effective\` AS effective_seed_category
    ON effective_seed_category.user_id IS NULL
   AND effective_seed_category.category_id = resolved_transactions.resolved_category_id
`;

const transactionBaseQuery = `
  SELECT
    ${transactionSelectFields}
  FROM (
    ${transactionCurrentReadQuery}
  )
  WHERE TRUE
    AND (
      @query = ''
      OR description_norm LIKE CONCAT('%', @query, '%')
      OR merchant_norm LIKE CONCAT('%', @query, '%')
    )
    AND (NOT @hasAccountIds OR account_id IN UNNEST(@accountIds))
    AND (NOT @hasCategoryGroups OR category_group IN UNNEST(@categoryGroups))
    AND (NOT @hasCategoryIds OR derived_category_id IN UNNEST(@categoryIds))
    AND (@merchant = '' OR merchant_norm LIKE CONCAT('%', @merchant, '%'))
    AND (@direction = '' OR direction = @direction)
    AND (@transactionClass = '' OR transaction_class = @transactionClass)
    AND (@pending = '' OR (@pending = 'pending' AND pending) OR (@pending = 'posted' AND NOT pending))
    AND (@from = '' OR posted_at >= DATE(@from))
    AND (@to = '' OR posted_at <= DATE(@to))
    AND (@minAmount < 0 OR ABS(signed_amount) >= @minAmount)
    AND (@maxAmount < 0 OR ABS(signed_amount) <= @maxAmount)
    AND (NOT @excludePlaid OR source_name != 'plaid')
  ORDER BY posted_at DESC, ABS(signed_amount) DESC
`;

function mapTransaction(row: RawTransaction): Transaction {
  return {
    ...row,
    authorizedAt: row.authorizedAt ? coerceDateString(row.authorizedAt) : null,
    postedAt: coerceDateString(row.postedAt),
    signedAmount: coerceNumber(row.signedAmount),
    categoryGroup: row.categoryGroup || "Uncategorized",
    confidenceScore: coerceNumber(row.confidenceScore),
    classificationHistory: (row.classificationHistory ?? []).map((entry) => ({
      timestamp: coerceDateString(entry.timestamp),
      source: entry.source,
      confidenceScore: coerceNumber(entry.confidence_score),
      categoryId: entry.category_id,
      categoryLabel: entry.category_label,
      note: entry.note,
    })),
  };
}

export async function getTransactions(filters: TransactionFilters) {
  const userId = await getCurrentUserId();
  const params = buildTransactionQueryParams(filters);
  const rows = userId
    ? await runBigQueryQuery<RawTransaction>(transactionBaseQuery, {
        ...params,
        userId,
      })
    : null;

  if (rows) {
    return rows.map(mapTransaction);
  }

  return sampleTransactions.filter((transaction) =>
    matchesFilters(transaction, filters),
  );
}

export async function getRecentTransactions(limit = 8, timeFilter?: TimeFilter) {
  const userId = await getCurrentUserId();
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 25);
  const rows = userId
    ? await runBigQueryQuery<RawTransaction>(
        `${transactionBaseQuery}\nLIMIT ${boundedLimit}`,
        {
          ...buildTransactionQueryParams({
            ...scopeToTransactionFilters(timeFilter),
          }),
          userId,
        },
      )
    : null;

  if (rows) {
    return rows.map(mapTransaction);
  }

  return [...sampleTransactions]
    .filter((transaction) =>
      matchesFilters(transaction, scopeToTransactionFilters(timeFilter)),
    )
    .sort((left, right) => {
      if (left.postedAt === right.postedAt) {
        return Math.abs(right.signedAmount) - Math.abs(left.signedAmount);
      }

      return right.postedAt.localeCompare(left.postedAt);
    })
    .slice(0, boundedLimit);
}

export async function getTransactionById(transactionId: string) {
  const userId = await getCurrentUserId();
  const rows = userId
    ? await runBigQueryQuery<RawTransaction>(
        `
      SELECT
        ${transactionSelectFields}
      FROM (
        ${transactionCurrentReadQuery}
      )
      WHERE transaction_id = @transactionId
      LIMIT 1
    `,
        { transactionId, userId, excludePlaid: true },
      )
    : null;

  if (rows?.[0]) {
    return {
      ...mapTransaction(rows[0]),
      relatedTransfers: [],
      rawEvents: [],
    } satisfies TransactionDetail;
  }

  // An authenticated, warehouse-backed user with no match gets null (no sample leak).
  if (userId) {
    return null;
  }

  return sampleTransactionDetails[transactionId] ?? null;
}

export async function getTransactionSearchSuggestions(query: string) {
  const normalized = normalizeDescription(query);

  if (!normalized) {
    return [];
  }

  const userId = await getCurrentUserId();
  const rows = userId
    ? await runBigQueryQuery<TransactionSearchSuggestion>(
        `
      SELECT label, type
      FROM \`${projectId}.mart_finance.search_suggestions\`
      WHERE user_id = @userId
        AND SEARCH(label, @query)
      LIMIT 8
    `,
        { query, userId },
      )
    : null;

  if (rows) {
    return rows;
  }

  const suggestions = sampleTransactions.flatMap<TransactionSearchSuggestion>(
    (transaction) => {
      const nextSuggestions: TransactionSearchSuggestion[] = [];

      if (
        normalizeDescription(transaction.merchantRaw).includes(normalized) ||
        normalizeDescription(transaction.merchantNorm).includes(normalized)
      ) {
        nextSuggestions.push({
          label: transaction.merchantRaw,
          type: "merchant",
        });
      }

      if (normalizeDescription(transaction.categoryLabel).includes(normalized)) {
        nextSuggestions.push({
          label: transaction.categoryLabel,
          type: "category",
        });
      }

      if (transaction.keywordArray.some((keyword) => keyword.includes(normalized))) {
        nextSuggestions.push({
          label: transaction.keywordArray.find((keyword) =>
            keyword.includes(normalized),
          )!,
          type: "keyword",
        });
      }

      return nextSuggestions;
    },
  );

  return uniqueSearchSuggestions(suggestions).slice(0, 8);
}
