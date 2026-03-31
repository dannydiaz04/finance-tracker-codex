import { NextRequest, NextResponse } from "next/server";

import { getTransactionSearchSuggestions } from "@/lib/queries/transactions";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("query") ?? "";

  if (!query.trim()) {
    return NextResponse.json({ data: [] });
  }

  const suggestions = await getTransactionSearchSuggestions(query);

  return NextResponse.json({ data: suggestions });
}
