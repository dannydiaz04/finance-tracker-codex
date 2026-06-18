import NextAuth from "next-auth";

import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PAGE_PREFIXES = ["/sign-in", "/sign-up"];

export default auth((request) => {
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
