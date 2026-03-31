import { NextRequest, NextResponse } from "next/server";

import type { PlaidWebhookPayload } from "@/lib/plaid/types";

export async function POST(request: NextRequest) {
  const payload = (await request.json()) as PlaidWebhookPayload;

  return NextResponse.json({
    received: true,
    plaidReady: Boolean(
      process.env.PLAID_CLIENT_ID &&
        process.env.PLAID_SECRET &&
        process.env.PLAID_ENV,
    ),
    nextAction:
      "Persist the webhook metadata, then enqueue /transactions/sync using the stored cursor.",
    payload,
  });
}
