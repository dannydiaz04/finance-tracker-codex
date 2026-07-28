import {
  RuleGuardrailError,
  planOverride,
  type ExistingRule,
  type OverridePlan,
} from "./override-plan.ts";

type PlanOverrideInput = Parameters<typeof planOverride>[0];

export type OverrideBatchItem = Pick<
  PlanOverrideInput,
  "transaction" | "category" | "action" | "note" | "suggestionId" | "ruleId"
>;

export type PlannedOverride = {
  transactionId: string;
  plan: OverridePlan;
};

/**
 * Plan a review batch in request order while making each newly-created rule visible
 * to later items. This prevents duplicate rules and rejects contradictory assignments
 * for the same merchant before any warehouse rows are written.
 */
export function planOverrideBatch(input: {
  userId: string;
  items: OverrideBatchItem[];
  existingRules: ExistingRule[];
  now: string;
}): PlannedOverride[] {
  let workingRules = input.existingRules.map((rule) => ({ ...rule }));
  const batchRuleIds = new Set<string>();

  return input.items.map((item) => {
    const plan = planOverride({
      userId: input.userId,
      transaction: item.transaction,
      category: item.category,
      action: item.action,
      note: item.note,
      existingRules: workingRules,
      now: input.now,
      suggestionId: item.suggestionId,
      ruleId: item.ruleId,
    });

    if (plan.supersedeRuleId && batchRuleIds.has(plan.supersedeRuleId)) {
      throw new RuleGuardrailError(
        `This batch assigns ${item.transaction.merchantRaw} to conflicting subcategories.`,
      );
    }

    if (plan.ruleRow) {
      if (plan.supersedeRuleId) {
        workingRules = workingRules.map((rule) =>
          rule.ruleId === plan.supersedeRuleId ? { ...rule, enabled: false } : rule,
        );
      }

      workingRules.push({
        ruleId: plan.ruleRow.rule_id,
        matchStrategy: plan.ruleRow.match_strategy,
        matchValue: plan.ruleRow.match_value,
        categoryId: plan.ruleRow.category_id,
        enabled: true,
      });
      batchRuleIds.add(plan.ruleRow.rule_id);
    }

    return {
      transactionId: item.transaction.transactionId,
      plan,
    };
  });
}
