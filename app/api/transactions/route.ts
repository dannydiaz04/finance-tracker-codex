import { NextRequest, NextResponse } from "next/server";

import { normalizeTransactionFilters } from "@/lib/bigquery/params";
import { getTransactions } from "@/lib/queries/transactions";

export async function GET(request: NextRequest) {
  const filters = normalizeTransactionFilters(
    Object.fromEntries(request.nextUrl.searchParams.entries()),
  );
  const transactions = await getTransactions(filters);

  return NextResponse.json({
    data: transactions,
    summary: {
      count: transactions.length,
      lowConfidence: transactions.filter((row) => row.confidenceScore < 0.75)
        .length,
    },
  });
}
