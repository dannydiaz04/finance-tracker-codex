import { NextRequest, NextResponse } from "next/server";

import { resolveRouteUserId } from "@/lib/auth/session";
import { isBigQueryConfigured } from "@/lib/bigquery/client";
import { runPostIngestEnrichment } from "@/lib/ingestion/post-ingest";
import { getLowConfidenceSummary } from "@/lib/queries/enrichment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function parseLimit(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(Math.max(Math.trunc(value), 1), 200);
}

export async function GET() {
  const { response } = await resolveRouteUserId();

  if (response) {
    return response;
  }

  const summary = await getLowConfidenceSummary().catch(() => null);

  return NextResponse.json({
    summary,
    openAiConfigured: isOpenAiConfigured(),
    bigQueryConfigured: isBigQueryConfigured(),
  });
}

export async function POST(request: NextRequest) {
  const { userId, response } = await resolveRouteUserId();

  if (response) {
    return response;
  }

  let limit: number | undefined;

  try {
    const body = (await request.json()) as { limit?: number };
    limit = parseLimit(body?.limit);
  } catch {
    // No body: enrich with the default cap.
  }

  const result = await runPostIngestEnrichment({ userId, limit: limit ?? 50 });
  const summary = await getLowConfidenceSummary().catch(() => null);

  return NextResponse.json({
    result,
    summary,
    openAiConfigured: isOpenAiConfigured(),
    bigQueryConfigured: isBigQueryConfigured(),
  });
}
