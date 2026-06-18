import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

// Edge-safe base config shared by middleware and the full server config.
// It must NOT import Node-only modules (pg, bcrypt, the Drizzle adapter).
export const authConfig = {
  pages: {
    signIn: "/sign-in",
  },
  providers: [Google],
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
