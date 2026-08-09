import "server-only";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import type { PlannedOverride } from "@/lib/categorization/override-batch";
import {
  buildOverrideRows,
  buildRuleRows,
  buildRuleSuggestionRows,
} from "@/lib/categorization/override-persistence-rows";
import { getPendingSuggestionsForTransactions } from "@/lib/queries/rules";
import type { Rule } from "@/lib/types/finance";

export type OverridePersistenceResult = {
  transactionId: string;
  persisted: boolean;
  rulePersisted: boolean;
  ruleError: string | null;
  ruleSuggestionPersisted: boolean;
  ruleSuggestionError: string | null;
};

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
        buildOverrideRows(input.planned),
      )
    : false;

  const ruleRows = buildRuleRows({
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
    let pendingSuggestions: Awaited<
      ReturnType<typeof getPendingSuggestionsForTransactions>
    > = [];

    try {
      pendingSuggestions = await getPendingSuggestionsForTransactions({
        userId: input.userId,
        transactionIds,
      });
    } catch {
      // Best-effort cleanup: saving the new suggestions is still valuable.
    }

    try {
      const suggestionRows = buildRuleSuggestionRows({
        userId: input.userId,
        planned: input.planned,
        pendingSuggestions,
        now: input.now,
      });

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

  return input.planned.map(({ transactionId, plan }) => {
    const hasRuleWrite = Boolean(plan.ruleRow || plan.supersedeRuleId);
    const hasSuggestionWrite = Boolean(plan.ruleSuggestion);

    return {
      transactionId,
      persisted: overridePersisted,
      rulePersisted: hasRuleWrite && ruleRowsPersisted,
      ruleError: hasRuleWrite ? ruleError : null,
      ruleSuggestionPersisted:
        hasSuggestionWrite && suggestionRowsPersisted,
      ruleSuggestionError: hasSuggestionWrite ? ruleSuggestionError : null,
    };
  });
}
