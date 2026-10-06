import {
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "./user-scope.ts";

// The canonical fact is batch-built, while manual overrides are written immediately.
// Overlay each user's latest override at read time so saved category changes are visible
// without waiting for the next Dataform refresh.
export function buildTransactionCurrentReadQuery(projectId: string) {
  return `
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
      COALESCE(
        effective_user_category.category_l1,
        effective_seed_category.category_l1,
        resolved_transactions.category_group
      ) AS category_group,
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
    )
  FROM resolved_transactions
  LEFT JOIN \`${projectId}.core_finance.dim_category_effective\` AS effective_user_category
    ON effective_user_category.user_id = @userId
   AND effective_user_category.category_id = resolved_transactions.resolved_category_id
  LEFT JOIN \`${projectId}.core_finance.dim_category_effective\` AS effective_seed_category
    ON effective_seed_category.user_id IS NULL
   AND effective_seed_category.category_id = resolved_transactions.resolved_category_id
`;
}
