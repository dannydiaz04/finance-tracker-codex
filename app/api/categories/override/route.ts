import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import { buildOverrideIdentity } from "@/lib/categorization/override-identity";
import { persistOverridePlans } from "@/lib/categorization/override-persistence";
import {
  RuleGuardrailError,
  planOverride,
  resolveRuleAction,
  type ExistingRule,
} from "@/lib/categorization/override-plan";
import { getCategories } from "@/lib/queries/catalog";
import {
  countRuleMatches,
  getRules,
} from "@/lib/queries/rules";
import { getTransactionById } from "@/lib/queries/transactions";
import type { Rule } from "@/lib/types/finance";
import {
  refreshWarehouseMarts,
  summarizeWarehouseRefresh,
} from "@/lib/warehouse/dataform-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const booleanLikeSchema = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean(),
);

const overrideSchema = z.object({
  transactionId: z.string().min(1),
  categoryId: z.string().min(1),
  note: z.string().optional(),
  // New 3-way action; the legacy boolean is still accepted for the transaction drawer.
  ruleAction: z.enum(["none", "suggest", "create"]).optional(),
  createRuleSuggestion: booleanLikeSchema.optional(),
  dryRun: booleanLikeSchema.optional().default(false),
});

async function parseRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return overrideSchema.parse(await request.json());
  }

  const formData = await request.formData();
  return overrideSchema.parse({
    transactionId: formData.get("transactionId"),
    categoryId: formData.get("categoryId"),
    note: formData.get("note") ?? undefined,
    ruleAction: formData.get("ruleAction") ?? undefined,
    createRuleSuggestion: formData.get("createRuleSuggestion") ?? undefined,
    dryRun: formData.get("dryRun") ?? undefined,
  });
}

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

    const payload = await parseRequest(request);
    const [transaction, categories, rules] = await Promise.all([
      getTransactionById(payload.transactionId),
      getCategories(),
      getRules(),
    ]);

    // getTransactionById is user-scoped, so a missing transaction means the caller does
    // not own it (or it does not exist).
    if (!transaction) {
      return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }

    // The API is the trust boundary, not the <select>: never pin an unknown subcategory.
    const category = categories.find((item) => item.id === payload.categoryId);
    if (!category) {
      return NextResponse.json({ error: "Unknown subcategory." }, { status: 400 });
    }

    const action = resolveRuleAction({
      ruleAction: payload.ruleAction ?? null,
      createRuleSuggestion: payload.createRuleSuggestion ?? null,
    });

    const now = new Date().toISOString();
    // Deterministic identity → retries collide instead of duplicating, and duplicate
    // rule rows share a rule_id (fact_classification keeps the latest per rule_id).
    const identity = buildOverrideIdentity({
      userId,
      transactionId: payload.transactionId,
      categoryId: payload.categoryId,
    });

    let plan;
    try {
      plan = planOverride({
        userId,
        transaction,
        category,
        action,
        note: payload.note,
        existingRules: rules.map(toExistingRule),
        now,
        suggestionId: `rule-suggestion-${identity}`,
        ruleId: `learned-${identity}`,
      });
    } catch (error) {
      if (error instanceof RuleGuardrailError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    if (payload.dryRun) {
      const matchCount = plan.match
        ? await countRuleMatches({ userId, ...plan.match })
        : null;
      return NextResponse.json({
        status: "preview",
        dryRun: true,
        ruleAction: plan.ruleAction,
        categoryChanged: plan.categoryChanged,
        dedupe: plan.dedupe,
        conflictCategoryId: plan.conflictCategoryId,
        matchPreview: plan.matchPreview,
        matchCount,
        guardrailNote: plan.guardrailNote,
      });
    }

    const [persistence] = await persistOverridePlans({
      userId,
      planned: [{ transactionId: payload.transactionId, plan }],
      existingRules: rules,
      now,
    });

    if (persistence.persisted) {
      // The saved transaction is visible immediately through the live override overlay.
      // Rebuild the canonical facts after responding so active rules and downstream
      // reports catch up without making the user wait for Dataform.
      after(async () => {
        const warehouseRefresh = await refreshWarehouseMarts();
        console.info("[category:override] warehouse refresh complete", {
          warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
        });
      });
    }

    return NextResponse.json({
      status: "accepted",
      persisted: persistence.persisted,
      override: plan.overrideRow,
      ruleAction: plan.ruleAction,
      categoryChanged: plan.categoryChanged,
      dedupe: plan.dedupe,
      matchPreview: plan.matchPreview,
      guardrailNote: plan.guardrailNote,
      ruleSuggestion: plan.ruleSuggestion,
      ruleSuggestionPersisted: persistence.ruleSuggestionPersisted,
      ruleSuggestionError: persistence.ruleSuggestionError,
      rule: plan.ruleRow,
      rulePersisted: persistence.rulePersisted,
      ruleError: persistence.ruleError,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid override payload." },
      { status: 400 },
    );
  }
}
