import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import { planOverrideBatch } from "@/lib/categorization/override-batch";
import { buildOverrideIdentity } from "@/lib/categorization/override-identity";
import { persistOverridePlans } from "@/lib/categorization/override-persistence";
import {
  RuleGuardrailError,
  resolveRuleAction,
  type ExistingRule,
} from "@/lib/categorization/override-plan";
import { getCategories } from "@/lib/queries/catalog";
import { getRules } from "@/lib/queries/rules";
import { getTransactionsByIds } from "@/lib/queries/transactions";
import type { Rule } from "@/lib/types/finance";
import {
  refreshWarehouseMarts,
  summarizeWarehouseRefresh,
} from "@/lib/warehouse/dataform-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const batchOverrideSchema = z
  .object({
    overrides: z
      .array(
        z.object({
          transactionId: z.string().min(1),
          categoryId: z.string().min(1),
          note: z.string().optional(),
          ruleAction: z.enum(["none", "suggest", "create"]).optional(),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine(({ overrides }, context) => {
    const seen = new Set<string>();
    overrides.forEach((override, index) => {
      if (seen.has(override.transactionId)) {
        context.addIssue({
          code: "custom",
          path: ["overrides", index, "transactionId"],
          message: "Each transaction can appear only once in a batch.",
        });
      }
      seen.add(override.transactionId);
    });
  });

function toExistingRule(rule: Rule): ExistingRule {
  return {
    ruleId: rule.id,
    matchStrategy: rule.matchStrategy,
    matchValue: rule.matchValue,
    categoryId: rule.categoryId,
    enabled: rule.enabled,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { userId, response } = await resolveRouteUserId();
    if (response) {
      return response;
    }

    const payload = batchOverrideSchema.parse(await request.json());
    const transactionIds = payload.overrides.map((override) => override.transactionId);
    const [transactions, categories, rules] = await Promise.all([
      getTransactionsByIds(transactionIds),
      getCategories(),
      getRules(),
    ]);
    const transactionById = new Map(
      transactions.map((transaction) => [transaction.transactionId, transaction]),
    );
    const categoryById = new Map(categories.map((category) => [category.id, category]));

    for (const override of payload.overrides) {
      if (!transactionById.has(override.transactionId)) {
        return NextResponse.json(
          { error: `Transaction ${override.transactionId} was not found.` },
          { status: 404 },
        );
      }
      if (!categoryById.has(override.categoryId)) {
        return NextResponse.json(
          { error: `Unknown subcategory ${override.categoryId}.` },
          { status: 400 },
        );
      }
    }

    const now = new Date().toISOString();
    let planned;
    try {
      planned = planOverrideBatch({
        userId,
        existingRules: rules.map(toExistingRule),
        now,
        items: payload.overrides.map((override) => {
          const identity = buildOverrideIdentity({
            userId,
            transactionId: override.transactionId,
            categoryId: override.categoryId,
          });
          return {
            transaction: transactionById.get(override.transactionId)!,
            category: categoryById.get(override.categoryId)!,
            action: resolveRuleAction({ ruleAction: override.ruleAction ?? null }),
            note: override.note,
            suggestionId: `rule-suggestion-${identity}`,
            ruleId: `learned-${identity}`,
          };
        }),
      });
    } catch (error) {
      if (error instanceof RuleGuardrailError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const persistence = await persistOverridePlans({
      userId,
      planned,
      existingRules: rules,
      now,
    });
    const persistenceById = new Map(
      persistence.map((result) => [result.transactionId, result]),
    );

    if (persistence.some((result) => result.persisted)) {
      after(async () => {
        const warehouseRefresh = await refreshWarehouseMarts();
        console.info("[category:overrides] warehouse refresh complete", {
          count: planned.length,
          warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
        });
      });
    }

    const results = planned.map(({ transactionId, plan }) => {
      const result = persistenceById.get(transactionId)!;
      return {
        status: "accepted",
        transactionId,
        persisted: result.persisted,
        override: plan.overrideRow,
        ruleAction: plan.ruleAction,
        categoryChanged: plan.categoryChanged,
        dedupe: plan.dedupe,
        matchPreview: plan.matchPreview,
        guardrailNote: plan.guardrailNote,
        ruleSuggestion: plan.ruleSuggestion,
        ruleSuggestionPersisted: result.ruleSuggestionPersisted,
        ruleSuggestionError: result.ruleSuggestionError,
        rule: plan.ruleRow,
        rulePersisted: result.rulePersisted,
        ruleError: result.ruleError,
      };
    });

    return NextResponse.json({
      status: "accepted",
      accepted: results.length,
      persisted: results.every((result) => result.persisted),
      results,
    });
  } catch (error) {
    const invalidRequest = error instanceof z.ZodError;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to save review batch." },
      { status: invalidRequest ? 400 : 500 },
    );
  }
}
