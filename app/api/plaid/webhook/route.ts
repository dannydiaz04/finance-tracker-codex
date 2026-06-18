import { NextRequest, NextResponse } from "next/server";

import { updatePlaidItemStatus } from "@/lib/plaid/items";
import { syncPlaidItemById } from "@/lib/plaid/sync";
import type { PlaidWebhookPayload } from "@/lib/plaid/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Plaid expects a 2xx quickly; do the work inline since volume is low for a
  // single-user app, but never fail the webhook because of downstream errors.
  try {
    if (
      webhookType === "TRANSACTIONS" &&
      webhookCode &&
      TRANSACTION_SYNC_CODES.has(webhookCode) &&
      itemId
    ) {
      const result = await syncPlaidItemById(itemId);
      return NextResponse.json({ received: true, action: "synced", result });
    }

    if (webhookType === "ITEM" && webhookCode === "ERROR" && itemId) {
      const errorMessage =
        typeof payload.error?.error_message === "string"
          ? payload.error.error_message
          : "Plaid reported an item error.";
      await updatePlaidItemStatus(itemId, "error", errorMessage);
      return NextResponse.json({ received: true, action: "item_error" });
    }
  } catch (error) {
    return NextResponse.json({
      received: true,
      action: "deferred",
      error: error instanceof Error ? error.message : "Webhook handler failed.",
    });
  }

  return NextResponse.json({ received: true, action: "ignored" });
}
