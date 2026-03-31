import "server-only";

import { getBigQueryProjectId, runBigQueryQuery } from "@/lib/bigquery/client";
import { sampleAccounts, sampleCategories } from "@/lib/sample-data";
import type { Account, Category } from "@/lib/types/finance";

export async function getAccounts() {
  const projectId = getBigQueryProjectId() ?? "project";
  const rows = await runBigQueryQuery<Account>(
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

  return rows ?? sampleAccounts;
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
