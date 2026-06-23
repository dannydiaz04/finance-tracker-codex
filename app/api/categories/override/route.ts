import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";

import { resolveRouteUserId } from "@/lib/auth/session";
import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import {
  RuleGuardrailError,
  planOverride,
  resolveRuleAction,
  type ExistingRule,
} from "@/lib/categorization/override-plan";
import { getCategories } from "@/lib/queries/catalog";
import {
  countRuleMatches,
  getPendingSuggestionsForTransaction,
  getRules,
} from "@/lib/queries/rules";
import { getTransactionById } from "@/lib/queries/transactions";
import type { Rule } from "@/lib/types/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// A fresh override for a transaction makes any earlier pending suggestion stale.
async function supersedePriorSuggestions(input: {
  userId: string;
  transactionId: string;
  keepSuggestionId: string;
  now: string;
}) {
  const pending = await getPendingSuggestionsForTransaction({
    userId: input.userId,
    transactionId: input.transactionId,
  });
  const stale = pending.filter((row) => row.suggestion_id !== input.keepSuggestionId);

  if (stale.length === 0) {
    return;
  }

  await insertBigQueryRows(
    "ops_finance",
    "category_rule_suggestions",
    stale.map((row) => ({
      user_id: input.userId,
      suggestion_id: row.suggestion_id,
      transaction_id: row.transaction_id,
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
    })),
  );
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

    // The API is the trust boundary, not the <select>: never pin an unknown category.
    const category = categories.find((item) => item.id === payload.categoryId);
    if (!category) {
      return NextResponse.json({ error: "Unknown category." }, { status: 400 });
    }

    const action = resolveRuleAction({
      ruleAction: payload.ruleAction ?? null,
      createRuleSuggestion: payload.createRuleSuggestion ?? null,
    });

    const now = new Date().toISOString();
    // Deterministic identity → retries collide instead of duplicating, and duplicate
    // rule rows share a rule_id (fact_classification keeps the latest per rule_id).
    const identity = createHash("sha1")
      .update([userId, payload.transactionId, payload.categoryId].join("|"))
      .digest("hex")
      .slice(0, 24);

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

    const bigQueryConfigured = isBigQueryConfigured();
    const overridePersisted = bigQueryConfigured
      ? await insertBigQueryRows("ops_finance", "manual_overrides", [plan.overrideRow])
      : false;

    let rulePersisted = false;
    let ruleError: string | null = null;

    // Supersede a contradictory rule (disable tombstone) before writing the corrected one.
    if (bigQueryConfigured && plan.supersedeRuleId) {
      const conflict = rules.find((rule) => rule.id === plan.supersedeRuleId);
      if (conflict) {
        try {
          await insertBigQueryRows("ops_finance", "category_rules", [
            disabledTombstone(conflict, userId, now),
          ]);
        } catch (error) {
          ruleError =
            error instanceof Error ? error.message : "Unable to supersede the conflicting rule.";
        }
      }
    }

    if (bigQueryConfigured && plan.ruleRow) {
      try {
        rulePersisted = await insertBigQueryRows("ops_finance", "category_rules", [plan.ruleRow]);
      } catch (error) {
        ruleError = error instanceof Error ? error.message : "Unable to save the rule.";
      }
    }

    let ruleSuggestionPersisted = false;
    let ruleSuggestionError: string | null = null;

    if (bigQueryConfigured && plan.ruleSuggestion) {
      try {
        await supersedePriorSuggestions({
          userId,
          transactionId: payload.transactionId,
          keepSuggestionId: plan.ruleSuggestion.suggestion_id,
          now,
        });
      } catch {
        // Best-effort: a stale pending suggestion left behind is non-fatal.
      }
      try {
        ruleSuggestionPersisted = await insertBigQueryRows(
          "ops_finance",
          "category_rule_suggestions",
          [plan.ruleSuggestion],
        );
      } catch (error) {
        ruleSuggestionError =
          error instanceof Error ? error.message : "Unable to save rule suggestion.";
      }
    }

    return NextResponse.json({
      status: "accepted",
      persisted: overridePersisted,
      override: plan.overrideRow,
      ruleAction: plan.ruleAction,
      categoryChanged: plan.categoryChanged,
      dedupe: plan.dedupe,
      matchPreview: plan.matchPreview,
      guardrailNote: plan.guardrailNote,
      ruleSuggestion: plan.ruleSuggestion,
      ruleSuggestionPersisted,
      ruleSuggestionError,
      rule: plan.ruleRow,
      rulePersisted,
      ruleError,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid override payload." },
      { status: 400 },
    );
  }
}
