import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import { buildRuleSuggestionDraft } from "@/lib/categorization/rule-suggestions";
import { getCategories } from "@/lib/queries/catalog";
import { getTransactionById } from "@/lib/queries/transactions";

const booleanLikeSchema = z.preprocess(
  (value) => value === true || value === "true" || value === "on" || value === "1",
  z.boolean(),
);

const overrideSchema = z.object({
  transactionId: z.string().min(1),
  categoryId: z.string().min(1),
  note: z.string().optional(),
  createRuleSuggestion: booleanLikeSchema.optional().default(true),
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
    note: formData.get("note"),
    createRuleSuggestion: formData.get("createRuleSuggestion"),
  });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await parseRequest(request);
    const [transaction, categories] = await Promise.all([
      getTransactionById(payload.transactionId),
      getCategories(),
    ]);
    const category = categories.find((item) => item.id === payload.categoryId);
    const row = {
      transaction_id: payload.transactionId,
      category_id: payload.categoryId,
      reason: payload.note ?? "Saved from transaction drawer.",
      updated_at: new Date().toISOString(),
    };
    const ruleSuggestionDraft =
      payload.createRuleSuggestion && transaction && category
        ? buildRuleSuggestionDraft({
            transaction,
            category,
            matchStrategy: "merchant_contains",
          })
        : null;
    const ruleSuggestion = ruleSuggestionDraft
      ? {
          suggestion_id: `rule-suggestion-${randomUUID()}`,
          transaction_id: payload.transactionId,
          category_id: ruleSuggestionDraft.categoryId,
          category_label: ruleSuggestionDraft.categoryLabel,
          match_strategy: ruleSuggestionDraft.matchStrategy,
          match_value: ruleSuggestionDraft.matchValue,
          rule_name: ruleSuggestionDraft.ruleName,
          rule_description: ruleSuggestionDraft.ruleDescription,
          source: "manual_override",
          status: "pending",
          note: payload.note ?? null,
          created_at: row.updated_at,
          updated_at: row.updated_at,
          reviewed_at: null,
        }
      : null;

    const bigQueryConfigured = isBigQueryConfigured();
    const overridePersisted = bigQueryConfigured
      ? await insertBigQueryRows("ops_finance", "manual_overrides", [row])
      : false;
    let ruleSuggestionPersisted = false;
    let ruleSuggestionError: string | null = null;

    if (bigQueryConfigured && ruleSuggestion) {
      try {
        ruleSuggestionPersisted = await insertBigQueryRows(
          "ops_finance",
          "category_rule_suggestions",
          [ruleSuggestion],
        );
      } catch (error) {
        ruleSuggestionError =
          error instanceof Error ? error.message : "Unable to save rule suggestion.";
      }
    }

    return NextResponse.json({
      status: "accepted",
      persisted: overridePersisted,
      override: row,
      ruleSuggestion,
      ruleSuggestionPersisted,
      ruleSuggestionError,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid override payload.",
      },
      { status: 400 },
    );
  }
}
