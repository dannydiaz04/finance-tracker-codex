"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Landmark, Loader2 } from "lucide-react";
import {
  usePlaidLink,
  type PlaidLinkError,
  type PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";

import { Button } from "@/components/ui/button";

// Persist the original link_token so we can resume Link after an OAuth bank
// redirects the browser away and back. sessionStorage (not localStorage) is
// tab-scoped, survives the same-tab OAuth bounce, and auto-clears on tab close.
const LINK_TOKEN_STORAGE_KEY = "plaid:link-token";

// Plaid appends `?oauth_state_id=<uuid>` to the configured redirect_uri when it
// sends the browser back after an OAuth flow. Its presence is how we detect that
// we must re-initialize Link instead of starting a fresh one.
function readOAuthReturn(): { isOAuth: boolean; href: string } {
  if (typeof window === "undefined") {
    return { isOAuth: false, href: "" };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    isOAuth: params.has("oauth_state_id"),
    href: window.location.href,
  };
}

type PlaidLinkInnerProps = {
  token: string;
  // Set ONLY on the OAuth-return path. Because react-plaid-link excludes
  // receivedRedirectUri from usePlaidLink's effect deps, this component must be
  // mounted with both `token` and `receivedRedirectUri` already present.
  receivedRedirectUri?: string;
  onFinished: () => void;
  onError: (message: string) => void;
};

function PlaidLinkInner({
  token,
  receivedRedirectUri,
  onFinished,
  onError,
}: PlaidLinkInnerProps) {
  // Guard against Strict Mode / double open().
  const openedRef = useRef(false);

  const clearStoredToken = useCallback(() => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(LINK_TOKEN_STORAGE_KEY);
    }
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
      clearStoredToken();

      try {
        const response = await fetch("/api/plaid/exchange", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicToken,
            institutionId: metadata.institution?.institution_id ?? null,
            institutionName: metadata.institution?.name ?? null,
          }),
        });
        const data = (await response.json()) as { error?: string };

        if (!response.ok) {
          onError(data.error ?? "Failed to store the connection.");
          return;
        }
      } catch {
        onError("Network error while storing the connection.");
        return;
      }

      onFinished();
    },
    [clearStoredToken, onError, onFinished],
  );

  const onExit = useCallback(
    (error: PlaidLinkError | null) => {
      clearStoredToken();

      // A null error is a plain user cancel; surface only real failures.
      if (error) {
        onError(error.display_message || error.error_message || "Plaid exited.");
      }

      onFinished();
    },
    [clearStoredToken, onError, onFinished],
  );

  const { open, ready, error: linkError } = usePlaidLink({
    token,
    receivedRedirectUri,
    onSuccess,
    onExit,
  });

  // Surface a Plaid script/SDK load failure. Otherwise usePlaidLink never turns
  // `ready`, open() (and thus onSuccess/onExit) never fire, and the button is
  // stuck on "Opening Plaid…" forever with no feedback.
  useEffect(() => {
    if (linkError) {
      onError("Could not load Plaid. Please try again.");
    }
  }, [linkError, onError]);

  // Watchdog: recover the button if Link never becomes ready (e.g. the CDN
  // script hangs without erroring). Cleared the moment Link is ready — the
  // open() effect takes over from there, so an open modal is never interrupted.
  useEffect(() => {
    if (ready) {
      return;
    }

    const timer = setTimeout(() => {
      onError("Plaid is taking too long to load. Please try again.");
    }, 30000);

    return () => clearTimeout(timer);
  }, [ready, onError]);

  useEffect(() => {
    if (ready && !openedRef.current) {
      openedRef.current = true;
      open();
    }
  }, [ready, open]);

  return null;
}

export function PlaidLinkButton() {
  const router = useRouter();
  // Capture the OAuth return state once, synchronously, before any URL cleanup.
  const oauthReturnRef = useRef<{ isOAuth: boolean; href: string } | null>(null);
  if (oauthReturnRef.current === null) {
    oauthReturnRef.current = readOAuthReturn();
  }

  const [token, setToken] = useState<string | null>(null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<
    string | undefined
  >(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OAuth-return path: re-initialize Link with the original token + href.
  // window & sessionStorage are client-only, so resuming an OAuth Link must run
  // in a mount effect — reading them during render would risk a hydration
  // mismatch (e.g. the expired-session message). This is a one-shot sync, not
  // the cascading-render pattern the rule guards against.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const oauthReturn = oauthReturnRef.current;
    if (!oauthReturn?.isOAuth) {
      return;
    }

    const storedToken = window.sessionStorage.getItem(LINK_TOKEN_STORAGE_KEY);

    if (!storedToken) {
      // No token to resume with (expired session, different tab, cleared
      // storage). Surface an error and drop the stale param so a refresh is a
      // no-op.
      setError("Your bank connection session expired. Please reconnect.");
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    // Set both in one batched update so PlaidLinkInner mounts already in resume
    // mode (receivedRedirectUri is not a usePlaidLink dependency).
    setToken(storedToken);
    setReceivedRedirectUri(oauthReturn.href);
    setLoading(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const startLink = useCallback(async () => {
    setLoading(true);
    setError(null);
    setReceivedRedirectUri(undefined);

    try {
      const response = await fetch("/api/plaid/link-token", { method: "POST" });
      const data = (await response.json()) as {
        linkToken?: string;
        error?: string;
      };

      if (!response.ok || !data.linkToken) {
        setError(data.error ?? "Unable to create a Plaid Link token.");
        setLoading(false);
        return;
      }

      // Persist before opening Link, because an OAuth bank may redirect the page
      // away (clearing React state) before onSuccess can run.
      window.sessionStorage.setItem(LINK_TOKEN_STORAGE_KEY, data.linkToken);
      setToken(data.linkToken);
    } catch {
      setError("Network error while creating a Plaid Link token.");
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    setReceivedRedirectUri(undefined);
    setLoading(false);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(LINK_TOKEN_STORAGE_KEY);
    }
  }, []);

  const finish = useCallback(() => {
    reset();
    // Drop oauth_state_id now that the hook has consumed it, so a manual refresh
    // doesn't try to resume a finished flow.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", window.location.pathname);
    }
    router.refresh();
  }, [reset, router]);

  // Stable identity so the inner watchdog/error effects aren't re-armed on every
  // parent render.
  const handleInnerError = useCallback(
    (message: string) => {
      setError(message);
      reset();
    },
    [reset],
  );

  return (
    <div className="flex flex-col items-start gap-2">
      <Button onClick={startLink} disabled={loading}>
        {loading ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Landmark className="mr-2 size-4" />
        )}
        {loading ? "Opening Plaid…" : "Connect a bank"}
      </Button>

      {token ? (
        <PlaidLinkInner
          token={token}
          receivedRedirectUri={receivedRedirectUri}
          onFinished={finish}
          onError={handleInnerError}
        />
      ) : null}

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
