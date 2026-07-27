import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import { applyRuleGuardrails } from "@/lib/categorization/override-plan";
import {
  RuleRevisionConflictError,
  planRuleRevision,
} from "@/lib/categorization/rule-revision";
import { getCategories } from "@/lib/queries/catalog";
import { getRules } from "@/lib/queries/rules";
import {
  refreshWarehouseMarts,
  summarizeWarehouseRefresh,
} from "@/lib/warehouse/dataform-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ruleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  priority: z.coerce.number().int().min(1),
  categoryId: z.string().min(1),
  matchStrategy: z.enum(["merchant_exact", "merchant_contains", "description_regex"]),
  matchValue: z.string().min(1),
});

const ruleUpdateSchema = ruleSchema.extend({
  ruleId: z.string().min(1),
});

type RulePayload = z.infer<typeof ruleSchema>;

async function resolveRuleCategory(categoryId: string) {
  const categories = await getCategories();
  const category = categories.find((item) => item.id === categoryId);
  if (!category) {
    throw new Error("Unknown subcategory.");
  }

  return category;
}

async function resolveRuleWrite(payload: RulePayload) {
  const category = await resolveRuleCategory(payload.categoryId);
  const guarded = applyRuleGuardrails({
    matchStrategy: payload.matchStrategy,
    matchValue: payload.matchValue,
  });

  return { category, guarded };
}

function scheduleRuleRefresh(action: "created" | "updated" | "disabled") {
  after(async () => {
    const warehouseRefresh = await refreshWarehouseMarts();
    console.info(`[rules:${action}] warehouse refresh complete`, {
      warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
    });
  });
}

export async function GET() {
  const rules = await getRules();
  return NextResponse.json({ data: rules });
}

export async function POST(request: NextRequest) {
  try {
    const { userId, response } = await resolveRouteUserId();

    if (response) {
      return response;
    }

    const payload = ruleSchema.parse(await request.json());
    const { category, guarded } = await resolveRuleWrite(payload);

    const row = {
      user_id: userId,
      rule_id: `rule-${Date.now()}`,
      name: payload.name,
      description: payload.description,
      priority: payload.priority,
      enabled: true,
      category_id: payload.categoryId,
      category_label: category.label,
      match_strategy: guarded.matchStrategy,
      match_value: guarded.matchValue,
      confidence_boost: 0.95,
      hit_rate: 0,
      last_matched_at: null,
      created_at: new Date().toISOString(),
    };

    const persisted = isBigQueryConfigured()
      ? await insertBigQueryRows("ops_finance", "category_rules", [row])
      : false;

    if (persisted) {
      scheduleRuleRefresh("created");
    }

    return NextResponse.json({
      status: "accepted",
      persisted,
      rule: row,
      guardrailNote: guarded.reason,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid rule payload." },
      { status: 400 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { userId, response } = await resolveRouteUserId();
    if (response) {
      return response;
    }

    const payload = ruleUpdateSchema.parse(await request.json());
    const rules = await getRules();
    const existing = rules.find((item) => item.id === payload.ruleId);
    if (!existing) {
      return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    }

    const category = await resolveRuleCategory(payload.categoryId);
    const plan = planRuleRevision({
      userId,
      existingRule: existing,
      otherRules: rules.filter((rule) => rule.id !== existing.id),
      category,
      draft: payload,
      now: new Date().toISOString(),
    });
    const persisted =
      plan.row && isBigQueryConfigured()
        ? await insertBigQueryRows("ops_finance", "category_rules", [plan.row])
        : plan.status === "unchanged";

    if (plan.row && persisted) {
      scheduleRuleRefresh("updated");
    }

    return NextResponse.json({
      status: plan.status,
      persisted,
      rule: plan.rule,
      guardrailNote: plan.guardrailNote,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid rule update." },
      { status: error instanceof RuleRevisionConflictError ? 409 : 400 },
    );
  }
}

// Disable a rule by appending a tombstone row with enabled=false. category_rules is
// append-only and fact_classification keeps the latest row per (user_id, rule_id), so
// the disabled version wins on the next warehouse refresh. This is the only in-app way
// to recover from a bad/over-broad rule.
export async function DELETE(request: NextRequest) {
  try {
    const { userId, response } = await resolveRouteUserId();

    if (response) {
      return response;
    }

    const ruleId = new URL(request.url).searchParams.get("ruleId");
    if (!ruleId) {
      return NextResponse.json({ error: "ruleId is required." }, { status: 400 });
    }

    const rules = await getRules();
    const rule = rules.find((item) => item.id === ruleId);
    if (!rule) {
      return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    }

    const tombstone = {
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
      created_at: new Date().toISOString(),
    };

    const persisted = isBigQueryConfigured()
      ? await insertBigQueryRows("ops_finance", "category_rules", [tombstone])
      : false;

    if (persisted) {
      scheduleRuleRefresh("disabled");
    }

    return NextResponse.json({ status: "disabled", persisted, rule: tombstone });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to disable rule." },
      { status: 400 },
    );
  }
}
