"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";

type PlaidSyncButtonProps = {
  itemId?: string;
  label?: string;
  /**
   * Render the result/error text as an overlay anchored under the button
   * instead of inline, so the button can live in a fixed-height row (e.g. the
   * dashboard header) without shifting surrounding layout.
   */
  floatingMessage?: boolean;
};

export function PlaidSyncButton({ itemId, label, floatingMessage }: PlaidSyncButtonProps) {
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
        warehouseRefresh?: {
          status: "ran" | "skipped" | "error";
          reason?: string;
          durationMs?: number;
        };
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

      const syncMessage = firstError?.reason
        ? firstError.reason
        : `Synced ${totals.added} new, ${totals.modified} updated, ${totals.removed} removed.`;
      const refreshMessage =
        data.warehouseRefresh?.status === "ran"
          ? "Warehouse refreshed."
          : data.warehouseRefresh?.status === "error"
            ? `Warehouse refresh failed: ${data.warehouseRefresh.reason ?? "unknown error"}`
            : data.warehouseRefresh?.status === "skipped"
              ? `Warehouse refresh skipped: ${data.warehouseRefresh.reason ?? "not requested"}`
              : null;

      setMessage([syncMessage, refreshMessage].filter(Boolean).join(" "));
      router.refresh();
    } catch {
      setMessage("Network error while syncing.");
    } finally {
      setLoading(false);
    }
  }, [itemId, router]);

  if (floatingMessage) {
    return (
      <div className="relative">
        <Button variant="secondary" size="sm" onClick={sync} disabled={loading}>
          {loading ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          {label ?? "Sync now"}
        </Button>
        {message ? (
          <p className="absolute right-0 top-full z-50 mt-2 max-w-[16rem] rounded-xl border border-white/10 bg-slate-950/95 px-3 py-2 text-xs text-slate-300 shadow-2xl backdrop-blur">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

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
