import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import { getRules } from "@/lib/queries/rules";
import { sampleCategories } from "@/lib/sample-data";

const ruleSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  priority: z.coerce.number().int().min(1),
  categoryId: z.string().min(1),
  matchStrategy: z.enum([
    "merchant_exact",
    "merchant_contains",
    "description_regex",
  ]),
  matchValue: z.string().min(1),
});

export async function GET() {
  const rules = await getRules();
  return NextResponse.json({ data: rules });
}

export async function POST(request: NextRequest) {
  try {
    const payload = ruleSchema.parse(await request.json());
    const categoryLabel =
      sampleCategories.find((category) => category.id === payload.categoryId)?.label ??
      payload.categoryId;
    const row = {
      rule_id: `rule-${Date.now()}`,
      name: payload.name,
      description: payload.description,
      priority: payload.priority,
      enabled: true,
      category_id: payload.categoryId,
      category_label: categoryLabel,
      match_strategy: payload.matchStrategy,
      match_value: payload.matchValue,
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
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid rule payload." },
      { status: 400 },
    );
  }
}
