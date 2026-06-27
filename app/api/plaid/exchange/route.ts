import { NextRequest, NextResponse } from "next/server";

import { resolveRouteUserId } from "@/lib/auth/session";
import { isBigQueryConfigured } from "@/lib/bigquery/client";
import {
  extractPlaidErrorMessage,
  getPlaidClient,
  resolveInstitutionName,
} from "@/lib/plaid/client";
import { getPlaidItem, upsertPlaidItem } from "@/lib/plaid/items";
import { removePlaidItemCompletely } from "@/lib/plaid/remove";
import { revalidatePlaidDependentViews } from "@/lib/plaid/revalidate";
import { syncPlaidItemById } from "@/lib/plaid/sync";
import {
  refreshWarehouseMarts,
  summarizeWarehouseRefresh,
} from "@/lib/warehouse/dataform-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const { userId, response: authResponse } = await resolveRouteUserId();

  if (authResponse) {
    return authResponse;
  }

  const client = getPlaidClient();

  if (!client) {
    return NextResponse.json(
      { error: "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET." },
      { status: 400 },
    );
  }

  if (!isBigQueryConfigured()) {
    return NextResponse.json(
      {
        error:
          "BigQuery is not configured, so the connection cannot be stored. Set BIGQUERY_PROJECT_ID.",
      },
      { status: 400 },
    );
  }

  let body: {
    publicToken?: string;
    institutionId?: string | null;
    institutionName?: string | null;
    // Set by the "Re-link for full history" (backfill) flow. The Item it names
    // is removed *after* this new Item is created, so a cancelled re-link never
    // destroys the existing connection.
    replacesItemId?: string | null;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const publicToken = body.publicToken?.trim();

  if (!publicToken) {
    return NextResponse.json(
      { error: "A `publicToken` is required." },
      { status: 400 },
    );
  }

  console.info("[plaid:exchange] received public token", {
    userId,
    institutionId: body.institutionId ?? null,
    institutionName: body.institutionName ?? null,
  });

  try {
    const exchange = await client.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchange.data.access_token;
    const itemId = exchange.data.item_id;

    const institutionId = body.institutionId?.trim() || null;
    const institutionName =
      body.institutionName?.trim() ||
      (await resolveInstitutionName(client, institutionId));

    await upsertPlaidItem({
      userId,
      itemId,
      accessToken,
      institutionId,
      institutionName,
    });

    // Backfill flow: now that the replacement Item exists, decommission the old
    // one and purge its raw events so the warehouse rebuild below contains a
    // single, full-history copy (no duplicates across the overlapping window).
    const replacesItemId = body.replacesItemId?.trim() || null;
    let replacedItemId: string | null = null;
    if (replacesItemId && replacesItemId !== itemId) {
      const previousItem = await getPlaidItem(replacesItemId);

      if (previousItem && previousItem.userId === userId) {
        try {
          await removePlaidItemCompletely({ client, item: previousItem });
          replacedItemId = replacesItemId;
        } catch (error) {
          // Don't fail the whole re-link if cleanup of the old Item hiccups; the
          // new connection is already live. Surface a safe message for logs.
          console.error("[plaid:exchange] failed to remove replaced item", {
            userId,
            replacesItemId,
            message: extractPlaidErrorMessage(error),
          });
        }
      }
    }

    const syncResult = await syncPlaidItemById(itemId);
    const warehouseRefresh = syncResult?.persisted
      ? await refreshWarehouseMarts()
      : {
          status: "skipped" as const,
          reason: "Plaid sync did not persist warehouse rows.",
        };
    revalidatePlaidDependentViews();

    console.info("[plaid:exchange] stored and synced item", {
      userId,
      itemId,
      institutionName,
      replacedItemId,
      sync: syncResult
        ? {
            status: syncResult.status,
            added: syncResult.added,
            modified: syncResult.modified,
            removed: syncResult.removed,
            accounts: syncResult.accounts,
            persisted: syncResult.persisted,
            reason: syncResult.reason,
          }
        : null,
      warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
    });

    return NextResponse.json({
      itemId,
      institutionName,
      replacedItemId,
      syncResult,
      warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
    });
  } catch (error) {
    // Log only the extracted, safe message — never the raw axios/Plaid error,
    // whose `.config` carries the public_token (body) and the PLAID-SECRET
    // request header.
    console.error("[plaid:exchange] failed", {
      userId,
      message: extractPlaidErrorMessage(error),
    });
    return NextResponse.json(
      { error: extractPlaidErrorMessage(error) },
      { status: 502 },
    );
  }
}
