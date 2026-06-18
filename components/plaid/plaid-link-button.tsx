"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Landmark, Loader2 } from "lucide-react";
import {
  usePlaidLink,
  type PlaidLinkOnSuccessMetadata,
} from "react-plaid-link";

import { Button } from "@/components/ui/button";

type PlaidLinkInnerProps = {
  token: string;
  onFinished: () => void;
  onError: (message: string) => void;
};

function PlaidLinkInner({ token, onFinished, onError }: PlaidLinkInnerProps) {
  const onSuccess = useCallback(
    async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
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
    [onError, onFinished],
  );

  const { open, ready } = usePlaidLink({
    token,
    onSuccess,
    onExit: () => onFinished(),
  });

  useEffect(() => {
    if (ready) {
      open();
    }
  }, [ready, open]);

  return null;
}

export function PlaidLinkButton() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startLink = useCallback(async () => {
    setLoading(true);
    setError(null);

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

      setToken(data.linkToken);
    } catch {
      setError("Network error while creating a Plaid Link token.");
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setToken(null);
    setLoading(false);
  }, []);

  const finish = useCallback(() => {
    reset();
    router.refresh();
  }, [reset, router]);

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
          onFinished={finish}
          onError={(message) => {
            setError(message);
            reset();
          }}
        />
      ) : null}

      {error ? <p className="text-sm text-rose-300">{error}</p> : null}
    </div>
  );
}
