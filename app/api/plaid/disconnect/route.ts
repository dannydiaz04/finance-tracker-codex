import { NextRequest, NextResponse } from "next/server";

import { resolveRouteUserId } from "@/lib/auth/session";
import { getPlaidClient } from "@/lib/plaid/client";
import { deletePlaidItem, getPlaidItem } from "@/lib/plaid/items";
import { removePlaidItemAtPlaid } from "@/lib/plaid/remove";
import { revalidatePlaidDependentViews } from "@/lib/plaid/revalidate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { userId, response: authResponse } = await resolveRouteUserId();

  if (authResponse) {
    return authResponse;
  }

  let body: { itemId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const itemId = body.itemId?.trim();
  if (!itemId) {
    return NextResponse.json({ error: "itemId is required." }, { status: 400 });
  }

  const item = await getPlaidItem(itemId);
  if (!item || item.userId !== userId) {
    return NextResponse.json({ error: "Plaid connection not found." }, { status: 404 });
  }

  // Release the Item at Plaid so it stops syncing (and stops being billable).
  // Best-effort: a failure here shouldn't block removing the local record.
  // Historical warehouse transactions are intentionally left intact.
  const client = getPlaidClient();
  if (client) {
    await removePlaidItemAtPlaid(client, item.accessToken);
  }

  const deleted = await deletePlaidItem(itemId);
  if (!deleted) {
    return NextResponse.json({ error: "Failed to disconnect." }, { status: 500 });
  }

  revalidatePlaidDependentViews();

  return NextResponse.json({ ok: true, itemId, institutionName: item.institutionName });
}
