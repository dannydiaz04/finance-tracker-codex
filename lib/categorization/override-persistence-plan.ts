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

export function buildOverrideRuleRows(input: {
  planned: PlannedOverride[];
  existingRules: Rule[];
  userId: string;
  now: string;
}): Record<string, unknown>[] {
  return input.planned.flatMap(({ plan }) => {
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
}

export function buildSupersededSuggestionRows(input: {
  pending: PendingSuggestionRow[];
  keepByTransaction: Map<string, string>;
  userId: string;
  now: string;
}): Record<string, unknown>[] {
  return input.pending
    .filter(
      (row) =>
        row.transaction_id &&
        row.suggestion_id !== input.keepByTransaction.get(row.transaction_id),
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
}

export function buildOverridePersistenceResults(input: {
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
