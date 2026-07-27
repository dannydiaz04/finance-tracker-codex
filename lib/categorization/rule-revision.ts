import {
  applyRuleGuardrails,
  dedupePlan,
  type DedupeStatus,
} from "./override-plan.ts";
import type { Category, Rule } from "../types/finance.ts";

export class RuleRevisionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleRevisionConflictError";
  }
}

type RuleRevisionDraft = Pick<
  Rule,
  "name" | "description" | "priority" | "categoryId" | "matchStrategy" | "matchValue"
>;

export type RuleRevisionPlan = {
  status: "updated" | "unchanged";
  row: {
    user_id: string;
    rule_id: string;
    name: string;
    description: string;
    priority: number;
    enabled: boolean;
    category_id: string;
    category_label: string;
    match_strategy: Rule["matchStrategy"];
    match_value: string;
    confidence_boost: number;
    hit_rate: number;
    last_matched_at: string | null;
    created_at: string;
  } | null;
  rule: Rule;
  dedupe: DedupeStatus;
  guardrailNote: string | null;
};

export function planRuleRevision(input: {
  userId: string;
  existingRule: Rule;
  otherRules: Rule[];
  category: Pick<Category, "id" | "label">;
  draft: RuleRevisionDraft;
  now: string;
}): RuleRevisionPlan {
  const guarded = applyRuleGuardrails({
    matchStrategy: input.draft.matchStrategy,
    matchValue: input.draft.matchValue,
  });
  const dedupe = dedupePlan({
    existingRules: input.otherRules.map((rule) => ({
      ruleId: rule.id,
      matchStrategy: rule.matchStrategy,
      matchValue: rule.matchValue,
      categoryId: rule.categoryId,
      enabled: rule.enabled,
    })),
    matchStrategy: guarded.matchStrategy,
    matchValue: guarded.matchValue,
    categoryId: input.category.id,
  });

  if (dedupe.status === "exists") {
    throw new RuleRevisionConflictError(
      "Another active rule already uses this match and subcategory. Edit that rule instead.",
    );
  }
  if (dedupe.status === "conflict") {
    throw new RuleRevisionConflictError(
      "Another active rule already uses this match for a different subcategory.",
    );
  }

  const rule: Rule = {
    ...input.existingRule,
    name: input.draft.name,
    description: input.draft.description,
    priority: input.draft.priority,
    enabled: true,
    categoryId: input.category.id,
    categoryLabel: input.category.label,
    matchStrategy: guarded.matchStrategy,
    matchValue: guarded.matchValue,
  };
  const unchanged =
    rule.name === input.existingRule.name &&
    rule.description === input.existingRule.description &&
    rule.priority === input.existingRule.priority &&
    rule.categoryId === input.existingRule.categoryId &&
    rule.categoryLabel === input.existingRule.categoryLabel &&
    rule.matchStrategy === input.existingRule.matchStrategy &&
    rule.matchValue === input.existingRule.matchValue &&
    input.existingRule.enabled;

  return {
    status: unchanged ? "unchanged" : "updated",
    row: unchanged
      ? null
      : {
          user_id: input.userId,
          rule_id: rule.id,
          name: rule.name,
          description: rule.description,
          priority: rule.priority,
          enabled: true,
          category_id: rule.categoryId,
          category_label: rule.categoryLabel,
          match_strategy: rule.matchStrategy,
          match_value: rule.matchValue,
          confidence_boost: rule.confidenceBoost,
          hit_rate: rule.hitRate,
          last_matched_at: rule.lastMatchedAt ?? null,
          created_at: input.now,
        },
    rule,
    dedupe: dedupe.status,
    guardrailNote: guarded.reason,
  };
}
