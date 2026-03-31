import { NextResponse } from "next/server";

export async function GET() {
  const configured = Boolean(
    process.env.PLAID_CLIENT_ID &&
      process.env.PLAID_SECRET &&
      process.env.PLAID_ENV,
  );

  return NextResponse.json({
    configured,
    message: configured
      ? "Plaid credentials are present. Implement link token exchange next."
      : "Plaid credentials are not configured yet. CSV import remains fully available.",
  });
}
