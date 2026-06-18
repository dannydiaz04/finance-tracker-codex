import { NextResponse } from "next/server";

import { resolveRouteUserId } from "@/lib/auth/session";
import {
  PLAID_COUNTRY_CODES,
  PLAID_PRODUCTS,
  extractPlaidErrorMessage,
  getPlaidClient,
  getPlaidConfig,
  getPlaidStatus,
} from "@/lib/plaid/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getPlaidStatus());
}

export async function POST() {
  const { userId, response: authResponse } = await resolveRouteUserId();

  if (authResponse) {
    return authResponse;
  }

  const client = getPlaidClient();

  if (!client) {
    return NextResponse.json(
      {
        error:
          getPlaidStatus().reason ??
          "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET.",
      },
      { status: 400 },
    );
  }

  const { webhookUrl, redirectUri } = getPlaidConfig();

  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "Finance Tracker",
      language: "en",
      country_codes: PLAID_COUNTRY_CODES,
      products: PLAID_PRODUCTS,
      ...(webhookUrl ? { webhook: webhookUrl } : {}),
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });

    return NextResponse.json({
      linkToken: response.data.link_token,
      expiration: response.data.expiration,
    });
  } catch (error) {
    return NextResponse.json(
      { error: extractPlaidErrorMessage(error) },
      { status: 502 },
    );
  }
}
