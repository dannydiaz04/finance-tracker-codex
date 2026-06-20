import { NextRequest, NextResponse } from "next/server";

import { resolveRouteUserId } from "@/lib/auth/session";
import { runPostIngestEnrichment } from "@/lib/ingestion/post-ingest";
import { getPlaidStatus } from "@/lib/plaid/client";
import { getPlaidItem, listPlaidItemsByUser } from "@/lib/plaid/items";
import { syncPlaidItem, syncPlaidItemsForUser } from "@/lib/plaid/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId, response } = await resolveRouteUserId();

  if (response) {
    return response;
  }

  const items = await listPlaidItemsByUser(userId);

  return NextResponse.json({
    plaid: getPlaidStatus(),
    items: items.map((item) => ({
      itemId: item.itemId,
      institutionName: item.institutionName,
      status: item.status,
      error: item.error,
      lastSyncedAt: item.lastSyncedAt,
      createdAt: item.createdAt,
    })),
  });
}

export async function POST(request: NextRequest) {
  const { userId, response } = await resolveRouteUserId();

  if (response) {
    return response;
  }

  let itemId: string | undefined;
  let enrich = false;

  try {
    const body = (await request.json()) as { itemId?: string; enrich?: boolean };
    itemId = body.itemId?.trim() || undefined;
    enrich = body.enrich ?? false;
  } catch {
    // No body: sync all of this user's items.
  }

  if (itemId) {
    const item = await getPlaidItem(itemId);

    if (!item || item.userId !== userId) {
      return NextResponse.json(
        { error: `No connected Plaid Item found for ${itemId}.` },
        { status: 404 },
      );
    }

    const result = await syncPlaidItem(item);
    const enrichment = enrich
      ? await runPostIngestEnrichment({ userId })
      : undefined;

    return NextResponse.json({
      results: [result],
      ...(enrichment ? { enrichment } : {}),
    });
  }

  const results = await syncPlaidItemsForUser(userId);
  const enrichment = enrich
    ? await runPostIngestEnrichment({ userId })
    : undefined;

  return NextResponse.json({
    results,
    ...(enrichment ? { enrichment } : {}),
  });
}
