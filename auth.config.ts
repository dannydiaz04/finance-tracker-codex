import type { NextAuthConfig } from "next-auth";

import { getGoogleOAuthProvider } from "@/lib/auth/google-oauth";

// Edge-safe base config shared by middleware and the full server config.
// It must NOT import Node-only modules (pg, bcrypt, the Drizzle adapter).
export const authConfig = {
  pages: {
    signIn: "/sign-in",
  },
  providers: [getGoogleOAuthProvider()],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
      }

      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }

      return session;
    },
  },
} satisfies NextAuthConfig;

export default authConfig;
