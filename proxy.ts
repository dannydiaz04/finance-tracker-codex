import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";

import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PAGE_PREFIXES = ["/sign-in", "/sign-up"];

// Canonical site origin, derived once from AUTH_URL. In Next 16 the proxy file
// (formerly middleware) runs on the Node.js runtime, so reading a server env var
// at module scope is reliable. `.origin` strips any stray path, so this stays
// correct even if AUTH_URL accidentally includes a callback path.
const CANONICAL = (() => {
  try {
    return process.env.AUTH_URL ? new URL(process.env.AUTH_URL) : null;
  } catch {
    return null;
  }
})();

// We only canonicalize when the canonical host is a www host: redirect its bare
// apex (financetracker.dev -> www.financetracker.dev) and nothing else.
const APEX_HOSTNAME =
  CANONICAL && CANONICAL.hostname.startsWith("www.")
    ? CANONICAL.hostname.slice(4)
    : null;

// Redirect bare-apex requests to the canonical www host, preserving path + query
// so an OAuth return's `?oauth_state_id` survives the hop. Returns null when no
// canonicalization applies. Never touches localhost or *.vercel.app previews.
function canonicalHostRedirect(request: NextRequest): Response | null {
  if (!CANONICAL || !APEX_HOSTNAME) {
    return null;
  }

  const host = (
    request.headers.get("x-forwarded-host") ??
    request.headers.get("host") ??
    ""
  )
    .split(":")[0]
    .toLowerCase();

  if (host !== APEX_HOSTNAME) {
    return null;
  }

  // Pin the origin to the canonical host, then attach path/query via setters,
  // which never reinterpret a leading "//" or "\" as a new authority. Building
  // `new URL(pathname + search, origin)` instead would let a crafted path like
  // "//evil.com" hijack the host — a protocol-relative open redirect.
  const target = new URL(CANONICAL.origin);
  target.pathname = request.nextUrl.pathname;
  target.search = request.nextUrl.search;

  // Defense in depth: never emit a cross-origin redirect.
  if (target.origin !== CANONICAL.origin) {
    return null;
  }

  // 308 = permanent + method/body-preserving.
  return NextResponse.redirect(target, 308);
}

export default auth((request) => {
  const hostRedirect = canonicalHostRedirect(request);
  if (hostRedirect) {
    return hostRedirect;
  }

  const { nextUrl } = request;
  const isLoggedIn = Boolean(request.auth);
  const { pathname } = nextUrl;

  // Auth.js endpoints and the Plaid server-to-server webhook are always allowed.
  if (pathname.startsWith("/api/auth") || pathname === "/api/plaid/webhook") {
    return;
  }

  const isPublicPage = PUBLIC_PAGE_PREFIXES.some((prefix) =>
    pathname.startsWith(prefix),
  );

  if (!isLoggedIn && !isPublicPage) {
    const signInUrl = new URL("/sign-in", nextUrl);
    signInUrl.searchParams.set("callbackUrl", `${pathname}${nextUrl.search}`);
    return Response.redirect(signInUrl);
  }

  if (isLoggedIn && isPublicPage) {
    return Response.redirect(new URL("/overview", nextUrl));
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
