"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type PlaidSyncButtonProps = {
  itemId?: string;
  label?: string;
};

export function PlaidSyncButton({ itemId, label }: PlaidSyncButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const sync = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/plaid/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      const data = (await response.json()) as {
        error?: string;
        results?: Array<{
          status: string;
          added: number;
          modified: number;
          removed: number;
          reason?: string;
        }>;
      };

      if (!response.ok) {
        setMessage(data.error ?? "Sync failed.");
        setLoading(false);
        return;
      }

      const totals = (data.results ?? []).reduce(
        (accumulator, result) => ({
          added: accumulator.added + result.added,
          modified: accumulator.modified + result.modified,
          removed: accumulator.removed + result.removed,
        }),
        { added: 0, modified: 0, removed: 0 },
      );
      const firstError = (data.results ?? []).find(
        (result) => result.status === "error" || result.status === "skipped",
      );

      setMessage(
        firstError?.reason
          ? firstError.reason
          : `Synced ${totals.added} new, ${totals.modified} updated, ${totals.removed} removed.`,
      );
      router.refresh();
    } catch {
      setMessage("Network error while syncing.");
    } finally {
      setLoading(false);
    }
  }, [itemId, router]);

  return (
    <div className="flex flex-col items-start gap-2">
      <Button variant="secondary" size="sm" onClick={sync} disabled={loading}>
        {loading ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 size-4" />
        )}
        {label ?? "Sync now"}
      </Button>
      {message ? <p className="text-xs text-slate-400">{message}</p> : null}
    </div>
  );
}
