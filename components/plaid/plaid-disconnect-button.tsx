"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Loader2, Unlink } from "lucide-react";

import { Button } from "@/components/ui/button";

type PlaidDisconnectButtonProps = {
  itemId: string;
  institutionName?: string | null;
};

export function PlaidDisconnectButton({
  itemId,
  institutionName,
}: PlaidDisconnectButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const disconnect = useCallback(async () => {
    if (
      !confirm(
        `Disconnect ${institutionName ?? "this institution"}? Historical transactions will remain.`,
      )
    ) {
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/plaid/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      const data = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage(data.error ?? "Failed to disconnect.");
        setLoading(false);
        return;
      }

      setMessage("Disconnected.");
      router.refresh();
    } catch {
      setMessage("Network error while disconnecting.");
    } finally {
      setLoading(false);
    }
  }, [itemId, institutionName, router]);

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={disconnect}
        disabled={loading}
        className="text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
      >
        {loading ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Unlink className="mr-2 size-4" />
        )}
        Disconnect
      </Button>
      {message ? <p className="text-xs text-slate-400">{message}</p> : null}
    </div>
  );
}
