import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import { RuleGuardrailError, applyRuleGuardrails } from "@/lib/categorization/override-plan";
import { getCategories } from "@/lib/queries/catalog";
import { getRules } from "@/lib/queries/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ruleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  priority: z.coerce.number().int().min(1),
  categoryId: z.string().min(1),
  matchStrategy: z.enum(["merchant_exact", "merchant_contains", "description_regex"]),
  matchValue: z.string().min(1),
});

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

    // The category must exist (the API is the trust boundary, not the form).
    const categories = await getCategories();
    const category = categories.find((item) => item.id === payload.categoryId);
    if (!category) {
      return NextResponse.json({ error: "Unknown category." }, { status: 400 });
    }

    // Sanitize/constrain the match value before it can reach the warehouse matcher
    // (strips LIKE metacharacters, forces exact for short/aggregator tokens, validates
    // regex so one bad pattern can't fail the shared fact_classification build).
    let guarded;
    try {
      guarded = applyRuleGuardrails({
        matchStrategy: payload.matchStrategy,
        matchValue: payload.matchValue,
      });
    } catch (error) {
      if (error instanceof RuleGuardrailError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

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

    return NextResponse.json({ status: "disabled", persisted, rule: tombstone });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to disable rule." },
      { status: 400 },
    );
  }
}
