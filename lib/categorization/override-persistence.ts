import "server-only";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import {
  createOverridePlanPersister,
  type OverridePersistenceResult,
} from "@/lib/categorization/override-persistence-core";
import { getPendingSuggestionsForTransactions } from "@/lib/queries/rules";

/**
 * Persist an already-validated set of plans with one insert per warehouse table.
 * BigQuery streaming inserts are not cross-table transactions, so rule-side failures
 * are returned separately while the core manual overrides remain successful.
 */
export const persistOverridePlans = createOverridePlanPersister({
  isBigQueryConfigured,
  insertBigQueryRows,
  getPendingSuggestionsForTransactions,
});

export type { OverridePersistenceResult };
