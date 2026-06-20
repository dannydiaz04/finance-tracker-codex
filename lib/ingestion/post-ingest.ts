import "server-only";

import {
  runAiCategoryEnrichment,
  type AiCategoryEnrichmentSummary,
} from "@/lib/ai-enrichment/category-classifier";
import { isBigQueryConfigured } from "@/lib/bigquery/client";

// Default cap so an interactive ingestion request does not fan out into an
// unbounded number of OpenAI calls.
const DEFAULT_POST_INGEST_LIMIT = 25;

export type PostIngestEnrichmentResult =
  | { status: "ran"; summary: AiCategoryEnrichmentSummary }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string };

function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

// Runs AI fallback over the user's low-confidence queue after data lands.
//
// This never throws: ingestion must not fail just because enrichment is
// unavailable. Note the AI queue reflects warehouse-modeled rows, so brand-new
// raw events only become eligible after the Dataform models refresh.
export async function runPostIngestEnrichment({
  userId,
  limit = DEFAULT_POST_INGEST_LIMIT,
}: {
  userId: string;
  limit?: number;
}): Promise<PostIngestEnrichmentResult> {
  if (!isBigQueryConfigured()) {
    return { status: "skipped", reason: "BigQuery is not configured." };
  }

  if (!isOpenAiConfigured()) {
    return {
      status: "skipped",
      reason: "OpenAI is not configured. Set OPENAI_API_KEY to enable AI fallback.",
    };
  }

  try {
    const summary = await runAiCategoryEnrichment({ userId, limit });
    return { status: "ran", summary };
  } catch (error) {
    return {
      status: "error",
      reason: error instanceof Error ? error.message : "AI enrichment failed.",
    };
  }
}
