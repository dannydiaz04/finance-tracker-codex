import { NextRequest, NextResponse } from "next/server";

import { resolveRouteUserId } from "@/lib/auth/session";
import { runPostIngestEnrichment } from "@/lib/ingestion/post-ingest";
import { getPlaidStatus } from "@/lib/plaid/client";
import { getPlaidItem, listPlaidItemsByUser } from "@/lib/plaid/items";
import { revalidatePlaidDependentViews } from "@/lib/plaid/revalidate";
import {
  syncPlaidItem,
  syncPlaidItemsForUser,
  type PlaidSyncResult,
} from "@/lib/plaid/sync";
import {
  refreshWarehouseMarts,
  summarizeWarehouseRefresh,
  type WarehouseRefreshResult,
} from "@/lib/warehouse/dataform-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function shouldRefreshWarehouse(results: PlaidSyncResult[]) {
  return results.some((result) => result.persisted);
}

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
  let refreshWarehouse = true;

  try {
    const body = (await request.json()) as {
      itemId?: string;
      enrich?: boolean;
      refreshWarehouse?: boolean;
    };
    itemId = body.itemId?.trim() || undefined;
    enrich = body.enrich ?? false;
    refreshWarehouse = body.refreshWarehouse ?? true;
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
    const warehouseRefresh: WarehouseRefreshResult =
      refreshWarehouse && shouldRefreshWarehouse([result])
        ? await refreshWarehouseMarts()
        : {
            status: "skipped",
            reason: refreshWarehouse
              ? "Plaid sync did not persist warehouse rows."
              : "Warehouse refresh was not requested.",
          };
    const enrichment = enrich
      ? await runPostIngestEnrichment({ userId })
      : undefined;

    revalidatePlaidDependentViews();

    return NextResponse.json({
      results: [result],
      warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
      ...(enrichment ? { enrichment } : {}),
    });
  }

  const results = await syncPlaidItemsForUser(userId);
  const warehouseRefresh: WarehouseRefreshResult =
    refreshWarehouse && shouldRefreshWarehouse(results)
      ? await refreshWarehouseMarts()
      : {
          status: "skipped",
          reason: refreshWarehouse
            ? "Plaid sync did not persist warehouse rows."
            : "Warehouse refresh was not requested.",
        };
  const enrichment = enrich
    ? await runPostIngestEnrichment({ userId })
    : undefined;

  revalidatePlaidDependentViews();

  return NextResponse.json({
    results,
    warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
    ...(enrichment ? { enrichment } : {}),
  });
}
