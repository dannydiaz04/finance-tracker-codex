import { NextResponse } from "next/server";

import { getTransactionById } from "@/lib/queries/transactions";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const transaction = await getTransactionById(id);

  if (!transaction) {
    return NextResponse.json(
      { error: "Transaction not found." },
      { status: 404 },
    );
  }

  return NextResponse.json({ data: transaction });
}
