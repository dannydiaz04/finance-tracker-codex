import "server-only";

import type { PlannedOverride } from "./override-batch.ts";
import {
  persistOverridePlansWithDependencies,
  type OverridePersistenceDependencies,
  type OverridePersistenceResult,
} from "./override-persistence-core.ts";
import type { Rule } from "../types/finance.ts";

export { persistOverridePlansWithDependencies };
export type { OverridePersistenceDependencies, OverridePersistenceResult };

async function loadDefaultDependencies(): Promise<OverridePersistenceDependencies> {
  const [bigQuery, rules] = await Promise.all([
    import("../bigquery/client.ts"),
    import("../queries/rules.ts"),
  ]);

  return {
    isBigQueryConfigured: bigQuery.isBigQueryConfigured,
    insertBigQueryRows: bigQuery.insertBigQueryRows,
    getPendingSuggestionsForTransactions: rules.getPendingSuggestionsForTransactions,
  };
}

/**
 * Persist an already-validated set of plans with one insert per warehouse table.
 * BigQuery streaming inserts are not cross-table transactions, so rule-side failures
 * are returned separately while the core manual overrides remain successful.
 */
export async function persistOverridePlans(input: {
  userId: string;
  planned: PlannedOverride[];
  existingRules: Rule[];
  now: string;
}): Promise<OverridePersistenceResult[]> {
  return persistOverridePlansWithDependencies(input, await loadDefaultDependencies());
}
