import { hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function POST(request: NextRequest) {
  const db = getDb();

  if (!db) {
    return NextResponse.json(
      { error: "Auth database is not configured. Set DATABASE_URL." },
      { status: 500 },
    );
  }

  let payload: z.infer<typeof registerSchema>;

  try {
    payload = registerSchema.parse(await request.json());
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Invalid registration payload.")
        : "Request body must be JSON.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const email = payload.email.toLowerCase().trim();

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json(
      { error: "An account with this email already exists." },
      { status: 409 },
    );
  }

  const passwordHash = await hash(payload.password, 12);
  const [created] = await db
    .insert(users)
    .values({
      email,
      name: payload.name ?? null,
      passwordHash,
    })
    .returning({ id: users.id });

  return NextResponse.json({ ok: true, userId: created.id });
}
