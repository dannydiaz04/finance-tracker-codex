import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { coerceNumber } from "@/lib/queries/coerce";
import { sampleAccounts, sampleCategories } from "@/lib/sample-data";
import type { Account, Category } from "@/lib/types/finance";

type RawAccount = Omit<Account, "currentBalance" | "availableBalance"> & {
  currentBalance: unknown;
  availableBalance: unknown;
};

export async function getAccounts() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<RawAccount>(
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
      ORDER BY name
    `,
  );

  return rows
    ? rows.map((row) => ({
        ...row,
        currentBalance: coerceNumber(row.currentBalance),
        availableBalance: coerceNumber(row.availableBalance),
      }))
    : sampleAccounts;
}

export async function getCategories() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<Category>(
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
  );

  return rows ?? sampleCategories;
}
