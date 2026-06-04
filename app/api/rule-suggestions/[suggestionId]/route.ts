import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  getBigQueryProjectId,
  insertBigQueryRows,
  isBigQueryConfigured,
  runBigQueryQuery,
} from "@/lib/bigquery/client";

const actionSchema = z.object({
  action: z.enum(["accept", "dismiss"]),
});

type RawSuggestion = {
  suggestion_id: string;
  transaction_id: string | null;
  category_id: string;
  category_label: string;
  match_strategy: string;
  match_value: string;
  rule_name: string;
  rule_description: string;
  source: string;
  note: string | null;
  created_at: string;
};

async function loadSuggestion(suggestionId: string) {
  const projectId = getBigQueryProjectId();

  if (!projectId) {
    return null;
  }

  const rows = await runBigQueryQuery<RawSuggestion>(
    `
      SELECT
        suggestion_id,
        transaction_id,
        category_id,
        category_label,
        match_strategy,
        match_value,
        rule_name,
        rule_description,
        source,
        note,
        CAST(created_at AS STRING) AS created_at
      FROM \`${projectId}.ops_finance.category_rule_suggestions\`
      QUALIFY
        ROW_NUMBER() OVER (
          PARTITION BY suggestion_id
          ORDER BY updated_at DESC
        ) = 1
        AND suggestion_id = @suggestionId
        AND status = "pending"
    `,
    { suggestionId },
  );

  return rows?.[0] ?? null;
}

async function insertSuggestionStatus({
  suggestion,
  status,
}: {
  suggestion: RawSuggestion;
  status: "accepted" | "dismissed";
}) {
  const now = new Date().toISOString();

  await insertBigQueryRows("ops_finance", "category_rule_suggestions", [
    {
      suggestion_id: suggestion.suggestion_id,
      transaction_id: suggestion.transaction_id,
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
      reviewed_at: now,
    },
  ]);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ suggestionId: string }> },
) {
  try {
    const { suggestionId } = await params;
    const payload = actionSchema.parse(await request.json());

    if (!isBigQueryConfigured()) {
      return NextResponse.json({
        status: payload.action === "accept" ? "accepted" : "dismissed",
        persisted: false,
      });
    }

    const suggestion = await loadSuggestion(suggestionId);

    if (!suggestion) {
      return NextResponse.json(
        { error: "Pending rule suggestion was not found." },
        { status: 404 },
      );
    }

    if (payload.action === "dismiss") {
      await insertSuggestionStatus({ suggestion, status: "dismissed" });
      return NextResponse.json({ status: "dismissed", persisted: true });
    }

    const now = new Date().toISOString();
    const rule = {
      rule_id: `learned-${suggestion.suggestion_id}`,
      name: suggestion.rule_name,
      description: suggestion.rule_description,
      priority: 110,
      enabled: true,
      category_id: suggestion.category_id,
      category_label: suggestion.category_label,
      match_strategy: suggestion.match_strategy,
      match_value: suggestion.match_value,
      confidence_boost: 0.95,
      hit_rate: 0,
      last_matched_at: null,
      created_at: now,
    };

    await insertBigQueryRows("ops_finance", "category_rules", [rule]);
    await insertSuggestionStatus({ suggestion, status: "accepted" });

    return NextResponse.json({
      status: "accepted",
      persisted: true,
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
