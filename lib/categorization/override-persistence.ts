import "server-only";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import type { PlannedOverride } from "@/lib/categorization/override-batch";
import {
  persistOverridePlansWithDependencies,
  type OverridePersistenceResult,
} from "@/lib/categorization/override-persistence-core";
import { getPendingSuggestionsForTransactions } from "@/lib/queries/rules";
import type { Rule } from "@/lib/types/finance";

export async function persistOverridePlans(input: {
  userId: string;
  planned: PlannedOverride[];
  existingRules: Rule[];
  now: string;
}): Promise<OverridePersistenceResult[]> {
  return persistOverridePlansWithDependencies(input, {
    configured: isBigQueryConfigured(),
    insertRows: insertBigQueryRows,
    getPendingSuggestionsForTransactions,
  });
}
