import "server-only";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import type { PlannedOverride } from "@/lib/categorization/override-batch";
import {
  buildOverridePersistenceResults,
  buildRulePersistenceRows,
  buildRuleSuggestionPersistenceRows,
  type OverridePersistenceResult,
} from "@/lib/categorization/override-persistence-plan";
import { getPendingSuggestionsForTransactions } from "@/lib/queries/rules";
import type { Rule } from "@/lib/types/finance";

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
  const configured = isBigQueryConfigured();
  const overridePersisted = configured
    ? await insertBigQueryRows(
        "ops_finance",
        "manual_overrides",
        input.planned.map(({ plan }) => plan.overrideRow),
      )
    : false;

  const ruleRows = buildRulePersistenceRows({
    userId: input.userId,
    planned: input.planned,
    existingRules: input.existingRules,
    now: input.now,
  });

  let ruleRowsPersisted = false;
  let ruleError: string | null = null;
  if (configured && ruleRows.length > 0) {
    try {
      ruleRowsPersisted = await insertBigQueryRows(
        "ops_finance",
        "category_rules",
        ruleRows,
      );
    } catch (error) {
      ruleError = error instanceof Error ? error.message : "Unable to save rule changes.";
    }
  }

  const suggestionPlans = input.planned.filter(({ plan }) => plan.ruleSuggestion);
  let suggestionRowsPersisted = false;
  let ruleSuggestionError: string | null = null;
  if (configured && suggestionPlans.length > 0) {
    const transactionIds = suggestionPlans.map(({ transactionId }) => transactionId);
    let suggestionRows: Record<string, unknown>[] = [];

    try {
      const pending = await getPendingSuggestionsForTransactions({
        userId: input.userId,
        transactionIds,
      });
      suggestionRows = buildRuleSuggestionPersistenceRows({
        userId: input.userId,
        planned: input.planned,
        pending,
        now: input.now,
      });
    } catch {
      // Best-effort cleanup: saving the new suggestions is still valuable.
      suggestionRows = buildRuleSuggestionPersistenceRows({
        userId: input.userId,
        planned: input.planned,
        pending: [],
        now: input.now,
      });
    }

    try {
      suggestionRowsPersisted = await insertBigQueryRows(
        "ops_finance",
        "category_rule_suggestions",
        suggestionRows,
      );
    } catch (error) {
      ruleSuggestionError =
        error instanceof Error ? error.message : "Unable to save rule suggestions.";
    }
  }

  return buildOverridePersistenceResults({
    planned: input.planned,
    overridePersisted,
    ruleRowsPersisted,
    ruleError,
    suggestionRowsPersisted,
    ruleSuggestionError,
  });
}
