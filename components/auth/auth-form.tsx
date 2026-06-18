"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AuthFormProps = {
  mode: "sign-in" | "sign-up";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/overview";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignUp = mode === "sign-up";

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (isSignUp) {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name || undefined, email, password }),
        });
        const data = (await response.json()) as { error?: string };

        if (!response.ok) {
          setError(data.error ?? "Could not create your account.");
          setLoading(false);
          return;
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("Invalid email or password.");
        setLoading(false);
        return;
      }

      router.push(callbackUrl as Route);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setGoogleLoading(true);
    setError(null);
    await signIn("google", { callbackUrl });
  };

  return (
    <div className="w-full max-w-md space-y-6 rounded-3xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur">
      <div className="space-y-2 text-center">
        <p className="text-xs uppercase tracking-[0.32em] text-cyan-300/80">
          Finance Tracker
        </p>
        <h1 className="text-2xl font-semibold text-white">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="text-sm text-slate-400">
          {isSignUp
            ? "Sign up to connect accounts and track your finances."
            : "Sign in to your finance workspace."}
        </p>
      </div>

      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={handleGoogle}
        disabled={googleLoading}
      >
        {googleLoading ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : null}
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500">
        <span className="h-px flex-1 bg-white/10" />
        or
        <span className="h-px flex-1 bg-white/10" />
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {isSignUp ? (
          <div className="space-y-1.5">
            <label className="text-sm text-slate-300" htmlFor="name">
              Name
            </label>
            <Input
              id="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Jane Doe"
              autoComplete="name"
            />
          </div>
        ) : null}

        <div className="space-y-1.5">
          <label className="text-sm text-slate-300" htmlFor="email">
            Email
          </label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm text-slate-300" htmlFor="password">
            Password
          </label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isSignUp ? "At least 8 characters" : "Your password"}
            autoComplete={isSignUp ? "new-password" : "current-password"}
          />
        </div>

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
          {isSignUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      <p className="text-center text-sm text-slate-400">
        {isSignUp ? (
          <>
            Already have an account?{" "}
            <Link className="text-cyan-300 hover:text-cyan-200" href="/sign-in">
              Sign in
            </Link>
          </>
        ) : (
          <>
            Need an account?{" "}
            <Link className="text-cyan-300 hover:text-cyan-200" href="/sign-up">
              Create one
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
