import { NextRequest, NextResponse } from "next/server";

import { resolveRouteUserId } from "@/lib/auth/session";
import { isBigQueryConfigured } from "@/lib/bigquery/client";
import {
  extractPlaidErrorMessage,
  getPlaidClient,
  resolveInstitutionName,
} from "@/lib/plaid/client";
import { upsertPlaidItem } from "@/lib/plaid/items";
import { syncPlaidItemById } from "@/lib/plaid/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    const syncResult = await syncPlaidItemById(itemId);

    console.info("[plaid:exchange] stored and synced item", {
      userId,
      itemId,
      institutionName,
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
    });

    return NextResponse.json({
      itemId,
      institutionName,
      syncResult,
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
