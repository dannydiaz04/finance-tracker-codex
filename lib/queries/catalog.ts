import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import {
  mergeCategoryDefinitions,
  type CategoryDefinitionRow,
} from "@/lib/categorization/category-catalog";
import { coerceNullableNumber, coerceNumber } from "@/lib/queries/coerce";
import { sampleAccounts, sampleCategories } from "@/lib/sample-data";
import type { Account, Category } from "@/lib/types/finance";

type RawAccount = Omit<Account, "currentBalance" | "availableBalance"> & {
  currentBalance: unknown;
  availableBalance: unknown;
};

export async function getAccounts() {
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = userId
    ? await runBigQueryQuery<RawAccount>(
        `
      SELECT
        account_id AS id,
        name,
        institution,
        type,
        subtype,
        currency,
        mask,
        current_balance AS currentBalance,
        available_balance AS availableBalance
      FROM \`${projectId}.core_finance.dim_account\`
      WHERE user_id = @userId
      ORDER BY name
    `,
        { userId },
      )
    : null;

  return rows
    ? rows.map((row) => ({
        ...row,
        currentBalance: coerceNumber(row.currentBalance),
        availableBalance: coerceNumber(row.availableBalance),
      }))
    : sampleAccounts;
}

type RawCategoryDefinition = {
  id: string;
  label: string;
  group: string;
  sublabel: string;
  color: string;
  sortOrder: unknown;
  status: string;
  isSystem: unknown;
};

/**
 * Effective catalog for the current user: the immutable seed dimension overlaid with the
 * user's latest active definitions from the append-only ops_finance.category_definitions
 * log. Reads are merged in the app (rather than the warehouse view) so user edits show up
 * immediately without waiting for a Dataform rebuild, and so a not-yet-deployed ops table
 * degrades gracefully to the seed.
 */
export async function getCategories(): Promise<Category[]> {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    return sampleCategories;
  }

  const userId = await getCurrentUserId();

  const seed = await runBigQueryQuery<Category>(
    `
      SELECT
        category_id AS id,
        label,
        category_l1 AS \`group\`,
        category_l2 AS sublabel,
        color
      FROM \`${projectId}.core_finance.dim_category\`
      ORDER BY label
    `,
  ).catch(() => null);

  const userRows = userId
    ? await runBigQueryQuery<RawCategoryDefinition>(
        `
          SELECT
            category_id AS id,
            label,
            category_l1 AS \`group\`,
            category_l2 AS sublabel,
            color,
            sort_order AS sortOrder,
            status,
            COALESCE(is_system, FALSE) AS isSystem
          FROM \`${projectId}.ops_finance.category_definitions\`
          WHERE user_id = @userId
          QUALIFY ROW_NUMBER() OVER (
            PARTITION BY category_id
            ORDER BY updated_at DESC
          ) = 1
        `,
        { userId },
      ).catch(() => null)
    : null;

  if (!seed && !userRows) {
    return sampleCategories;
  }

  const definitions: CategoryDefinitionRow[] = (userRows ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    group: row.group,
    sublabel: row.sublabel,
    color: row.color,
    sortOrder: coerceNullableNumber(row.sortOrder),
    status: row.status === "archived" ? "archived" : "active",
    isSystem: Boolean(row.isSystem),
  }));

  return mergeCategoryDefinitions(seed ?? sampleCategories, definitions);
}

/**
 * Count what currently references a category for this user, so the delete flow can block
 * archival until the user reassigns. Counts transactions classified to the category and
 * active deterministic rules that target it.
 */
export async function countCategoryReferences(
  userId: string,
  categoryId: string,
): Promise<{ transactions: number; rules: number }> {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    return { transactions: 0, rules: 0 };
  }

  const [txnRows, ruleRows] = await Promise.all([
    runBigQueryQuery<{ total: unknown }>(
      `
        SELECT COUNT(*) AS total
        FROM \`${projectId}.core_finance.fact_transaction_current\`
        WHERE user_id = @userId
          AND derived_category_id = @categoryId
      `,
      { userId, categoryId },
    ).catch(() => null),
    runBigQueryQuery<{ total: unknown }>(
      `
        SELECT COUNT(*) AS total
        FROM \`${projectId}.ops_finance.category_rules\`
        WHERE user_id = @userId
          AND category_id = @categoryId
        QUALIFY ROW_NUMBER() OVER (
          PARTITION BY rule_id
          ORDER BY created_at DESC
        ) = 1
          AND COALESCE(enabled, TRUE)
      `,
      { userId, categoryId },
    ).catch(() => null),
  ]);

  return {
    transactions: txnRows && txnRows[0] ? coerceNumber(txnRows[0].total) : 0,
    rules: ruleRows && ruleRows[0] ? coerceNumber(ruleRows[0].total) : 0,
  };
}

/** Transaction ids currently classified to a category — used to reassign on archive. */
export async function getTransactionIdsForCategory(
  userId: string,
  categoryId: string,
): Promise<string[]> {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    return [];
  }

  const rows = await runBigQueryQuery<{ transactionId: string }>(
    `
      SELECT transaction_id AS transactionId
      FROM \`${projectId}.core_finance.fact_transaction_current\`
      WHERE user_id = @userId
        AND derived_category_id = @categoryId
    `,
    { userId, categoryId },
  ).catch(() => null);

  return rows ? rows.map((row) => row.transactionId) : [];
}
