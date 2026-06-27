import { after, NextRequest, NextResponse } from "next/server";

import { updatePlaidItemStatus } from "@/lib/plaid/items";
import { revalidatePlaidDependentViews } from "@/lib/plaid/revalidate";
import { syncPlaidItemById } from "@/lib/plaid/sync";
import type { PlaidWebhookPayload } from "@/lib/plaid/types";
import {
  refreshWarehouseMarts,
  summarizeWarehouseRefresh,
} from "@/lib/warehouse/dataform-refresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TRANSACTION_SYNC_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
]);

export async function POST(request: NextRequest) {
  let payload: PlaidWebhookPayload;

  try {
    payload = (await request.json()) as PlaidWebhookPayload;
  } catch {
    return NextResponse.json(
      { received: false, error: "Webhook body must be JSON." },
      { status: 400 },
    );
  }

  const { webhook_type: webhookType, webhook_code: webhookCode, item_id: itemId } =
    payload;

  console.info("[plaid:webhook] received", {
    webhookType,
    webhookCode,
    itemId,
  });

  // Plaid expects a 2xx quickly. Keep Plaid sync inline, then schedule slower
  // warehouse refresh work after the response.
  try {
    if (
      webhookType === "TRANSACTIONS" &&
      webhookCode &&
      TRANSACTION_SYNC_CODES.has(webhookCode) &&
      itemId
    ) {
      const result = await syncPlaidItemById(itemId);
      if (result?.persisted) {
        after(async () => {
          const warehouseRefresh = await refreshWarehouseMarts();
          console.info("[plaid:webhook] warehouse refresh complete", {
            itemId,
            warehouseRefresh: summarizeWarehouseRefresh(warehouseRefresh),
          });
          revalidatePlaidDependentViews();
        });
      } else {
        revalidatePlaidDependentViews();
      }
      return NextResponse.json({ received: true, action: "synced", result });
    }

    if (webhookType === "ITEM" && webhookCode === "ERROR" && itemId) {
      const errorMessage =
        typeof payload.error?.error_message === "string"
          ? payload.error.error_message
          : "Plaid reported an item error.";
      await updatePlaidItemStatus(itemId, "error", errorMessage);
      revalidatePlaidDependentViews();
      return NextResponse.json({ received: true, action: "item_error" });
    }
  } catch (error) {
    // Log only the message — never the raw error. A downstream BigQuery
    // PartialFailureError embeds the offending transaction rows (user PII), and
    // a Plaid error would carry tokens/secrets in its axios config.
    console.error("[plaid:webhook] handler failed", {
      webhookType,
      webhookCode,
      itemId,
      message: error instanceof Error ? error.message : "Webhook handler failed.",
    });
    return NextResponse.json({
      received: true,
      action: "deferred",
      error: error instanceof Error ? error.message : "Webhook handler failed.",
    });
  }

  return NextResponse.json({ received: true, action: "ignored" });
}
