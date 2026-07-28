import "server-only";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import type { PlannedOverride } from "@/lib/categorization/override-batch";
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

function disabledTombstone(rule: Rule, userId: string, now: string) {
  return {
    user_id: userId,
    rule_id: rule.id,
    name: rule.name,
    description: rule.description,
    priority: rule.priority,
    enabled: false,
    category_id: rule.categoryId,
    category_label: rule.categoryLabel,
    match_strategy: rule.matchStrategy,
    match_value: rule.matchValue,
    confidence_boost: rule.confidenceBoost,
    hit_rate: rule.hitRate,
    last_matched_at: rule.lastMatchedAt ?? null,
    created_at: now,
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
  const configured = isBigQueryConfigured();
  const overridePersisted = configured
    ? await insertBigQueryRows(
        "ops_finance",
        "manual_overrides",
        input.planned.map(({ plan }) => plan.overrideRow),
      )
    : false;

  const ruleRows = input.planned.flatMap(({ plan }) => {
    const rows: Record<string, unknown>[] = [];
    if (plan.supersedeRuleId) {
      const conflict = input.existingRules.find(
        (rule) => rule.id === plan.supersedeRuleId,
      );
      if (conflict) {
        rows.push(disabledTombstone(conflict, input.userId, input.now));
      }
    }
    if (plan.ruleRow) {
      rows.push(plan.ruleRow);
    }
    return rows;
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
    const keepByTransaction = new Map(
      suggestionPlans.map(({ transactionId, plan }) => [
        transactionId,
        plan.ruleSuggestion!.suggestion_id,
      ]),
    );
    let staleRows: Record<string, unknown>[] = [];

    try {
      const pending = await getPendingSuggestionsForTransactions({
        userId: input.userId,
        transactionIds,
      });
      staleRows = pending
        .filter(
          (row) =>
            row.transaction_id &&
            row.suggestion_id !== keepByTransaction.get(row.transaction_id),
        )
        .map((row) => ({
          user_id: input.userId,
          suggestion_id: row.suggestion_id,
          transaction_id: row.transaction_id,
          priority: row.priority,
          category_id: row.category_id,
          category_label: row.category_label,
          match_strategy: row.match_strategy,
          match_value: row.match_value,
          rule_name: row.rule_name,
          rule_description: row.rule_description,
          source: row.source,
          status: "superseded",
          note: row.note,
          created_at: row.created_at,
          updated_at: input.now,
          reviewed_at: input.now,
        }));
    } catch {
      // Best-effort cleanup: saving the new suggestions is still valuable.
    }

    try {
      const suggestionRows = suggestionPlans.map(({ plan }) => plan.ruleSuggestion!);

      suggestionRowsPersisted = await insertBigQueryRows(
        "ops_finance",
        "category_rule_suggestions",
        [...staleRows, ...suggestionRows],
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
