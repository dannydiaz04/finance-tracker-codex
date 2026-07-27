import { after, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import {
  getBigQueryProjectId,
  insertBigQueryRows,
  isBigQueryConfigured,
  runBigQueryQuery,
} from "@/lib/bigquery/client";
import {
  LEARNED_RULE_CONFIDENCE,
  LEARNED_RULE_PRIORITY,
  RuleGuardrailError,
  applyRuleGuardrails,
  dedupePlan,
} from "@/lib/categorization/override-plan";
import { getCategories } from "@/lib/queries/catalog";
import { getRules } from "@/lib/queries/rules";
import type { Rule } from "@/lib/types/finance";
import {
  refreshWarehouseMarts,
  summarizeWarehouseRefresh,
} from "@/lib/warehouse/dataform-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const actionSchema = z.object({
  action: z.enum(["accept", "dismiss", "reopen"]),
});

const suggestionUpdateSchema = z.object({
  ruleName: z.string().min(1),
  ruleDescription: z.string().min(1),
  priority: z.coerce.number().int().min(1),
  categoryId: z.string().min(1),
  matchStrategy: z.enum(["merchant_exact", "merchant_contains", "description_regex"]),
  matchValue: z.string().min(1),
});

type SuggestionStatus = "pending" | "accepted" | "dismissed";

type RawSuggestion = {
  suggestion_id: string;
  transaction_id: string | null;
  priority: number | null;
  category_id: string;
  category_label: string;
  match_strategy: string;
  match_value: string;
  rule_name: string;
  rule_description: string;
  source: string;
  status: SuggestionStatus;
  note: string | null;
  created_at: string;
};

async function loadSuggestion(suggestionId: string, userId: string) {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    return null;
  }

  const rows = await runBigQueryQuery<RawSuggestion>(
    `
      SELECT
        suggestion_id,
        transaction_id,
        COALESCE(priority, ${LEARNED_RULE_PRIORITY}) AS priority,
        category_id,
        category_label,
        match_strategy,
        match_value,
        rule_name,
        rule_description,
        source,
        status,
        note,
        CAST(created_at AS STRING) AS created_at
      FROM \`${projectId}.ops_finance.category_rule_suggestions\`
      WHERE user_id = @userId
      QUALIFY
        ROW_NUMBER() OVER (
          PARTITION BY suggestion_id
          ORDER BY updated_at DESC
        ) = 1
        AND suggestion_id = @suggestionId
        AND status IN ("pending", "accepted", "dismissed")
    `,
    { suggestionId, userId },
  );

  return rows?.[0] ?? null;
}

async function insertSuggestionStatus({
  suggestion,
  status,
  userId,
}: {
  suggestion: RawSuggestion;
  status: SuggestionStatus;
  userId: string;
}) {
  const now = new Date().toISOString();

  await insertBigQueryRows("ops_finance", "category_rule_suggestions", [
    {
      user_id: userId,
      suggestion_id: suggestion.suggestion_id,
      transaction_id: suggestion.transaction_id,
      priority: suggestion.priority ?? LEARNED_RULE_PRIORITY,
      category_id: suggestion.category_id,
      category_label: suggestion.category_label,
      match_strategy: suggestion.match_strategy,
      match_value: suggestion.match_value,
      rule_name: suggestion.rule_name,
      rule_description: suggestion.rule_description,
      source: suggestion.source,
      status,
      note: suggestion.note,
      created_at: suggestion.created_at,
      updated_at: now,
      reviewed_at: status === "pending" ? null : now,
    },
  ]);
}

function disabledRuleRow(rule: Rule, userId: string, now: string) {
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

function scheduleSuggestionRefresh(event: "accepted" | "dismissed") {
  after(async () => {
    const warehouseRefresh = await refreshWarehouseMarts();
    console.info(`[rule-suggestion:${event}] warehouse refresh complete`, {
      warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
    });
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  try {
    const { userId, response } = await resolveRouteUserId();
    if (response) {
      return response;
    }

    const { suggestionId } = await params;
    const payload = suggestionUpdateSchema.parse(await request.json());
    const categories = await getCategories();
    const category = categories.find((item) => item.id === payload.categoryId);
    if (!category) {
      return NextResponse.json({ error: "Unknown subcategory." }, { status: 400 });
    }

    const guarded = applyRuleGuardrails({
      matchStrategy: payload.matchStrategy,
      matchValue: payload.matchValue,
    });
    const editableSuggestion = {
      priority: payload.priority,
      categoryId: category.id,
      categoryLabel: category.label,
      matchStrategy: guarded.matchStrategy,
      matchValue: guarded.matchValue,
      ruleName: payload.ruleName,
      ruleDescription: payload.ruleDescription,
    };

    if (!isBigQueryConfigured()) {
      return NextResponse.json({
        status: "updated",
        persisted: false,
        suggestion: editableSuggestion,
        guardrailNote: guarded.reason,
      });
    }

    const suggestion = await loadSuggestion(suggestionId, userId);
    if (!suggestion || suggestion.status !== "pending") {
      return NextResponse.json(
        { error: "Pending rule suggestion was not found." },
        { status: 404 },
      );
    }

    const now = new Date().toISOString();
    const persisted = await insertBigQueryRows("ops_finance", "category_rule_suggestions", [
      {
        user_id: userId,
        suggestion_id: suggestion.suggestion_id,
        transaction_id: suggestion.transaction_id,
        priority: payload.priority,
        category_id: category.id,
        category_label: category.label,
        match_strategy: guarded.matchStrategy,
        match_value: guarded.matchValue,
        rule_name: payload.ruleName,
        rule_description: payload.ruleDescription,
        source: suggestion.source,
        status: "pending",
        note: suggestion.note,
        created_at: suggestion.created_at,
        updated_at: now,
        reviewed_at: null,
      },
    ]);

    return NextResponse.json({
      status: "updated",
      persisted,
      suggestion: {
        suggestionId: suggestion.suggestion_id,
        transactionId: suggestion.transaction_id ?? "",
        ...editableSuggestion,
        source: suggestion.source,
        status: "pending",
        note: suggestion.note,
        createdAt: suggestion.created_at,
        updatedAt: now,
        reviewedAt: null,
      },
      guardrailNote: guarded.reason,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid rule suggestion update." },
      { status: 400 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  try {
    const { userId, response } = await resolveRouteUserId();

    if (response) {
      return response;
    }

    const { suggestionId } = await params;
    const payload = actionSchema.parse(await request.json());

    if (!isBigQueryConfigured()) {
      const status =
        payload.action === "reopen"
          ? "pending"
          : payload.action === "accept"
            ? "accepted"
            : "dismissed";
      return NextResponse.json({
        status,
        persisted: false,
      });
    }

    const suggestion = await loadSuggestion(suggestionId, userId);

    if (!suggestion) {
      return NextResponse.json(
        { error: "Rule suggestion was not found." },
        { status: 404 },
      );
    }

    if (payload.action === "reopen") {
      if (suggestion.status !== "pending") {
        await insertSuggestionStatus({ suggestion, status: "pending", userId });
      }
      return NextResponse.json({ status: "pending", persisted: true });
    }

    if (suggestion.status !== "pending") {
      return NextResponse.json(
        { error: "This suggestion was already reviewed. Reopen it before making changes." },
        { status: 409 },
      );
    }

    const existingRules = await getRules();
    const learnedRuleId = `learned-${suggestion.suggestion_id}`;
    const existingLearnedRule = existingRules.find(
      (rule) => rule.id === learnedRuleId,
    );

    if (payload.action === "dismiss") {
      if (existingLearnedRule) {
        await insertBigQueryRows("ops_finance", "category_rules", [
          disabledRuleRow(existingLearnedRule, userId, new Date().toISOString()),
        ]);
        scheduleSuggestionRefresh("dismissed");
      }
      await insertSuggestionStatus({ suggestion, status: "dismissed", userId });
      return NextResponse.json({
        status: "dismissed",
        persisted: true,
        revised: Boolean(existingLearnedRule),
      });
    }

    // Guard + dedupe at the REAL category_rules write boundary — the suggestion draft is
    // advisory; this accept is where an active rule (conf 0.95, above AI) is actually born.
    let guarded;
    try {
      guarded = applyRuleGuardrails({
        matchStrategy: suggestion.match_strategy as Rule["matchStrategy"],
        matchValue: suggestion.match_value,
      });
    } catch (error) {
      if (error instanceof RuleGuardrailError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const dedupe = dedupePlan({
      existingRules: existingRules.map((item) => ({
        ruleId: item.id,
        matchStrategy: item.matchStrategy,
        matchValue: item.matchValue,
        categoryId: item.categoryId,
        enabled: item.enabled,
      })),
      matchStrategy: guarded.matchStrategy,
      matchValue: guarded.matchValue,
      categoryId: suggestion.category_id,
    });

    const dedupeTargetsLearnedRule =
      dedupe.conflictRuleId === learnedRuleId;

    // An identical active rule already exists. When this is a reopened learned rule,
    // append a corrected version below; otherwise avoid writing a duplicate.
    if (dedupe.status === "exists" && !dedupeTargetsLearnedRule) {
      if (existingLearnedRule) {
        await insertBigQueryRows("ops_finance", "category_rules", [
          disabledRuleRow(existingLearnedRule, userId, new Date().toISOString()),
        ]);
        scheduleSuggestionRefresh("accepted");
      }
      await insertSuggestionStatus({ suggestion, status: "accepted", userId });
      return NextResponse.json({
        status: "accepted",
        persisted: true,
        dedupe: "exists",
        revised: Boolean(existingLearnedRule),
        rule: null,
      });
    }

    const now = new Date().toISOString();

    // Contradictory rule for the same merchant → disable it before writing the new one.
    if (
      dedupe.status === "conflict" &&
      dedupe.conflictRuleId &&
      dedupe.conflictRuleId !== learnedRuleId
    ) {
      const conflict = existingRules.find((item) => item.id === dedupe.conflictRuleId);
      if (conflict) {
        await insertBigQueryRows("ops_finance", "category_rules", [
          disabledRuleRow(conflict, userId, now),
        ]);
      }
    }

    const rule = {
      user_id: userId,
      rule_id: learnedRuleId,
      name: suggestion.rule_name,
      description: suggestion.rule_description,
      priority: suggestion.priority ?? LEARNED_RULE_PRIORITY,
      enabled: true,
      category_id: suggestion.category_id,
      category_label: suggestion.category_label,
      match_strategy: guarded.matchStrategy,
      match_value: guarded.matchValue,
      confidence_boost: LEARNED_RULE_CONFIDENCE,
      hit_rate: 0,
      last_matched_at: null,
      created_at: now,
    };

    await insertBigQueryRows("ops_finance", "category_rules", [rule]);
    await insertSuggestionStatus({ suggestion, status: "accepted", userId });

    scheduleSuggestionRefresh("accepted");

    return NextResponse.json({
      status: "accepted",
      persisted: true,
      dedupe: dedupe.status,
      revised: Boolean(existingLearnedRule),
      rule,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Invalid rule suggestion action.",
      },
      { status: 400 },
    );
  }
}
