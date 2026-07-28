"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { OverrideForm } from "@/components/transactions/override-form";
import { Button } from "@/components/ui/button";
import type {
  OverrideDraft,
  SaveResultTone,
} from "@/lib/categorization/override-form-state";
import type {
  Category,
  CategoryGroup,
  ReviewQueueItem,
} from "@/lib/types/finance";
import { cn, formatCurrency } from "@/lib/utils";

export type ReviewQueueResolution = {
  persisted: boolean;
  tone: SaveResultTone;
  message: string;
};

type ReviewQueueCardProps = {
  item: ReviewQueueItem;
  categories: Category[];
  categoryGroups: CategoryGroup[];
  saveMode?: "individual" | "batch";
  draft?: OverrideDraft;
  isStaged?: boolean;
  batchError?: string | null;
  batchResolution?: ReviewQueueResolution | null;
  onDraftChange?: (draft: OverrideDraft) => void;
  onStage?: () => void;
  onIndividualResolved?: (result: { persisted: boolean }) => void;
  onIndividualReopen?: () => void;
};

export function ReviewQueueCard({
  item,
  categories,
  categoryGroups,
  saveMode = "individual",
  draft,
  isStaged = false,
  batchError,
  batchResolution,
  onDraftChange,
  onStage,
  onIndividualResolved,
  onIndividualReopen,
}: ReviewQueueCardProps) {
  const [resolved, setResolved] = useState<{ persisted: boolean } | null>(null);
  const resolution =
    saveMode === "batch"
      ? batchResolution
      : resolved
        ? {
            persisted: resolved.persisted,
            tone: resolved.persisted ? ("success" as const) : ("local" as const),
            message: resolved.persisted
              ? "Removed from the queue; reflected in reports on the next warehouse refresh."
              : "Saved locally — connect a warehouse to persist this override.",
          }
        : batchResolution;

  if (resolution) {
    const partial = resolution.tone === "partial" || resolution.tone === "local";
    return (
      <div
        className={cn(
          "rounded-sm border bg-background px-4 py-4 text-sm",
          partial
            ? "border-amber-500/30 text-amber-400"
            : "border-emerald-500/30 text-emerald-400",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{item.merchant} — resolved</p>
            <p className={partial ? "mt-1 text-amber-400/80" : "mt-1 text-emerald-400/80"}>
              {resolution.message}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Editing appends a corrected category; it does not return this transaction to
              the review queue.
            </p>
          </div>
          {saveMode === "individual" ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="shrink-0 gap-1.5"
              onClick={() => {
                setResolved(null);
                onIndividualReopen?.();
              }}
            >
              <Pencil className="size-3.5" />
              Edit review
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-sm border bg-background px-4 py-4",
        saveMode === "batch" && isStaged
          ? "border-amber-500/40"
          : "border-border",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-white">{item.merchant}</p>
          <p className="mt-1 text-sm text-slate-400">{item.description}</p>
          <p className="mt-1 text-xs text-slate-500">{item.reason}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono font-medium text-white">{formatCurrency(item.amount)}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
            {(item.confidenceScore * 100).toFixed(0)}% confidence
          </p>
        </div>
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <OverrideForm
          variant="inline"
          transactionId={item.transactionId}
          currentCategoryId={item.currentCategoryId}
          suggestedCategoryLabel={item.suggestedCategory}
          categories={categories}
          categoryGroups={categoryGroups}
          saveMode={saveMode}
          draft={draft}
          isStaged={isStaged}
          batchError={batchError}
          onDraftChange={onDraftChange}
          onStage={onStage}
          onResolved={(outcome) => {
            setResolved(outcome);
            onIndividualResolved?.(outcome);
          }}
        />
      </div>
    </div>
  );
}
