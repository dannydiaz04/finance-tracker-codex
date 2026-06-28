import "server-only";

import { getCurrentUserId } from "@/lib/auth/session";
import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import {
  mergeCategoryDefinitions,
  type CategoryDefinitionRow,
} from "@/lib/categorization/category-catalog";
import { coerceNullableNumber, coerceNumber } from "@/lib/queries/coerce";
import { accountUserScopePredicate } from "@/lib/queries/user-scope";
import { sampleAccounts, sampleCategories } from "@/lib/sample-data";
import type { Account, Category } from "@/lib/types/finance";

type RawAccount = Omit<Account, "currentBalance" | "availableBalance"> & {
  currentBalance: unknown;
  availableBalance: unknown;
};

const accountTypes = new Set<Account["type"]>([
  "checking",
  "savings",
  "credit",
  "brokerage",
]);

function normalizeAccountType(value: string | null | undefined): Account["type"] {
  const normalized = value?.trim().toLowerCase();

  if (normalized && accountTypes.has(normalized as Account["type"])) {
    return normalized as Account["type"];
  }

  if (normalized?.includes("credit")) {
    return "credit";
  }

  if (normalized?.includes("saving")) {
    return "savings";
  }

  if (normalized?.includes("brokerage") || normalized?.includes("investment")) {
    return "brokerage";
  }

  return "checking";
}

function mapAccountRow(row: RawAccount): Account {
  return {
    id: row.id,
    name: row.name || row.id,
    institution: row.institution || "Unknown",
    type: normalizeAccountType(row.type),
    subtype: row.subtype || "",
    currency: row.currency || "USD",
    mask: row.mask || "unknown",
    currentBalance: coerceNumber(row.currentBalance),
    availableBalance: coerceNumber(row.availableBalance),
  };
}

function mergeAccountRows(coreRows: RawAccount[], liveRows: RawAccount[]) {
  const byId = new Map<string, Account>();

  for (const row of coreRows) {
    const account = mapAccountRow(row);
    byId.set(account.id, account);
  }

  for (const row of liveRows) {
    const account = mapAccountRow(row);
    byId.set(account.id, account);
  }

  return [...byId.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export async function getAccounts() {
  const userId = await getCurrentUserId();
  const projectId = getBigQueryProjectId() ?? "project";
  const [coreRows, liveRows] = userId
    ? await Promise.all([
        runBigQueryQuery<RawAccount>(
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
      WHERE ${accountUserScopePredicate()}
      ORDER BY name
    `,
          { userId },
        ).catch(() => null),
        runBigQueryQuery<RawAccount>(
          `
      SELECT
        account_id AS id,
        COALESCE(NULLIF(account_name, ''), account_id) AS name,
        COALESCE(NULLIF(institution, ''), 'Plaid') AS institution,
        COALESCE(NULLIF(account_type, ''), 'checking') AS type,
        COALESCE(NULLIF(account_subtype, ''), '') AS subtype,
        COALESCE(NULLIF(currency, ''), 'USD') AS currency,
        COALESCE(NULLIF(mask, ''), 'unknown') AS mask,
        current_balance AS currentBalance,
        available_balance AS availableBalance
      FROM (
        SELECT
          user_id,
          account_id,
          account_name,
          institution,
          account_type,
          account_subtype,
          currency,
          mask,
          current_balance,
          available_balance,
          is_active,
          ROW_NUMBER() OVER (
            PARTITION BY user_id, account_id
            ORDER BY updated_at DESC
          ) AS metadata_rank
        FROM \`${projectId}.ops_finance.account_metadata\`
        WHERE user_id = @userId
      )
      WHERE metadata_rank = 1
        AND COALESCE(is_active, TRUE)
      ORDER BY name
    `,
          { userId },
        ).catch(() => null),
      ])
    : [null, null];

  if (!coreRows && !liveRows) {
    return sampleAccounts;
  }

  return mergeAccountRows(coreRows ?? [], liveRows ?? []);
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
