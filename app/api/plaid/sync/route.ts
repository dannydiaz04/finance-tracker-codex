import { NextRequest, NextResponse } from "next/server";

import { resolveRouteUserId } from "@/lib/auth/session";
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

  try {
    const body = (await request.json()) as { itemId?: string };
    itemId = body.itemId?.trim() || undefined;
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
    return NextResponse.json({ results: [result] });
  }

  const results = await syncPlaidItemsForUser(userId);
  return NextResponse.json({ results });
}
