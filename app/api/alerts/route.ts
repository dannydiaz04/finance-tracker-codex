import { NextRequest, NextResponse } from "next/server";

import { getCashflowAlerts } from "@/lib/queries/alerts";
import { normalizeTimeFilter } from "@/lib/time-filter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const timeFilter = normalizeTimeFilter(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  const { alerts, summary } = await getCashflowAlerts(timeFilter);

  return NextResponse.json({ data: alerts, summary });
}
