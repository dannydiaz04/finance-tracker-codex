import type { PlannedOverride } from "./override-batch.ts";
import type { Rule } from "../types/finance.ts";

export type PendingSuggestionRow = {
  suggestion_id: string;
  transaction_id: string | null;
  priority: number;
  category_id: string;
  category_label: string;
  match_strategy: string;
  match_value: string;
  rule_name: string;
  rule_description: string;
  source: string;
  note: string | null;
  created_at: string;
};

export type OverridePersistenceResult = {
  transactionId: string;
  persisted: boolean;
  rulePersisted: boolean;
  ruleError: string | null;
  ruleSuggestionPersisted: boolean;
  ruleSuggestionError: string | null;
};

export function buildDisabledRuleTombstone(input: {
  rule: Rule;
  userId: string;
  now: string;
}) {
  return {
    user_id: input.userId,
    rule_id: input.rule.id,
    name: input.rule.name,
    description: input.rule.description,
    priority: input.rule.priority,
    enabled: false,
    category_id: input.rule.categoryId,
    category_label: input.rule.categoryLabel,
    match_strategy: input.rule.matchStrategy,
    match_value: input.rule.matchValue,
    confidence_boost: input.rule.confidenceBoost,
    hit_rate: input.rule.hitRate,
    last_matched_at: input.rule.lastMatchedAt ?? null,
    created_at: input.now,
  };
}

export function buildRulePersistenceRows(input: {
  planned: PlannedOverride[];
  existingRules: Rule[];
  userId: string;
  now: string;
}) {
  return input.planned.flatMap(({ plan }) => {
    const rows: Record<string, unknown>[] = [];
    if (plan.supersedeRuleId) {
      const conflict = input.existingRules.find(
        (rule) => rule.id === plan.supersedeRuleId,
      );
      if (conflict) {
        rows.push(
          buildDisabledRuleTombstone({
            rule: conflict,
            userId: input.userId,
            now: input.now,
          }),
        );
      }
    }
    if (plan.ruleRow) {
      rows.push(plan.ruleRow);
    }
    return rows;
  });
}

export function buildSuggestionPersistenceRows(input: {
  userId: string;
  planned: PlannedOverride[];
  pendingSuggestions: PendingSuggestionRow[];
  now: string;
}) {
  const suggestionPlans = input.planned.filter(({ plan }) => plan.ruleSuggestion);
  const keepByTransaction = new Map(
    suggestionPlans.map(({ transactionId, plan }) => [
      transactionId,
      plan.ruleSuggestion!.suggestion_id,
    ]),
  );

  const staleRows = input.pendingSuggestions
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

  const suggestionRows = suggestionPlans.map(({ plan }) => plan.ruleSuggestion!);
  return [...staleRows, ...suggestionRows];
}

export function mapOverridePersistenceResults(input: {
  planned: PlannedOverride[];
  overridePersisted: boolean;
  ruleRowsPersisted: boolean;
  ruleError: string | null;
  suggestionRowsPersisted: boolean;
  ruleSuggestionError: string | null;
}): OverridePersistenceResult[] {
  return input.planned.map(({ transactionId, plan }) => {
    const hasRuleWrite = Boolean(plan.ruleRow || plan.supersedeRuleId);
    const hasSuggestionWrite = Boolean(plan.ruleSuggestion);

    return {
      transactionId,
      persisted: input.overridePersisted,
      rulePersisted: hasRuleWrite && input.ruleRowsPersisted,
      ruleError: hasRuleWrite ? input.ruleError : null,
      ruleSuggestionPersisted:
        hasSuggestionWrite && input.suggestionRowsPersisted,
      ruleSuggestionError: hasSuggestionWrite ? input.ruleSuggestionError : null,
    };
  });
}
