import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";

const overrideSchema = z.object({
  transactionId: z.string().min(1),
  categoryId: z.string().min(1),
  note: z.string().optional(),
});

async function parseRequest(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return overrideSchema.parse(await request.json());
  }

  const formData = await request.formData();
  return overrideSchema.parse({
    transactionId: formData.get("transactionId"),
    categoryId: formData.get("categoryId"),
    note: formData.get("note"),
  });
}

export async function POST(request: NextRequest) {
  try {
    const payload = await parseRequest(request);
    const row = {
      transaction_id: payload.transactionId,
      category_id: payload.categoryId,
      reason: payload.note ?? "Saved from transaction drawer.",
      updated_at: new Date().toISOString(),
    };

    const persisted = isBigQueryConfigured()
      ? await insertBigQueryRows("ops_finance", "manual_overrides", [row])
      : false;

    return NextResponse.json({
      status: "accepted",
      persisted,
      override: row,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Invalid override payload.",
      },
      { status: 400 },
    );
  }
}
