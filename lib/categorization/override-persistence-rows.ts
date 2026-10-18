import type { PlannedOverride } from "./override-batch.ts";
import type { Rule } from "../types/finance.ts";

export type PendingSuggestionForSupersede = {
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

export function buildOverrideRows(planned: PlannedOverride[]) {
  return planned.map(({ plan }) => plan.overrideRow);
}

export function buildRuleRows(input: {
  userId: string;
  planned: PlannedOverride[];
  existingRules: Rule[];
  now: string;
}) {
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

export function buildRuleSuggestionRows(input: {
  userId: string;
  planned: PlannedOverride[];
  pendingSuggestions: PendingSuggestionForSupersede[];
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
        keepByTransaction.has(row.transaction_id) &&
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

  return [
    ...staleRows,
    ...suggestionPlans.map(({ plan }) => plan.ruleSuggestion!),
  ];
}
