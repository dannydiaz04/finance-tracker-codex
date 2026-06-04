import { NextResponse } from "next/server";

import { getRuleSuggestions } from "@/lib/queries/rules";

export async function GET() {
  const suggestions = await getRuleSuggestions();
  return NextResponse.json({ data: suggestions });
}
