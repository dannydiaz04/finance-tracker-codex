import "server-only";

import { NextResponse } from "next/server";

import { auth } from "@/auth";

export class UnauthorizedError extends Error {
  constructor(message = "Authentication required.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function requireUserId(): Promise<string> {
  const userId = await getCurrentUserId();

  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}

// Helper for route handlers: resolves the user id or returns a 401 response.
export async function resolveRouteUserId(): Promise<
  { userId: string; response?: never } | { userId?: never; response: NextResponse }
> {
  const userId = await getCurrentUserId();

  if (!userId) {
    return {
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  }

  return { userId };
}
