import "server-only";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import {
  persistOverridePlansWithDependencies,
  type OverridePersistenceResult,
} from "@/lib/categorization/override-persistence-core";
import type { PlannedOverride } from "@/lib/categorization/override-batch";
import { getPendingSuggestionsForTransactions } from "@/lib/queries/rules";
import type { Rule } from "@/lib/types/finance";

export type { OverridePersistenceResult };

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
  return persistOverridePlansWithDependencies(
    {
      isConfigured: isBigQueryConfigured,
      insertRows: insertBigQueryRows,
      getPendingSuggestionsForTransactions,
    },
    input,
  );
}
