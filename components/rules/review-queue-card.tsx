"use client";

import { useState } from "react";

import { OverrideForm } from "@/components/transactions/override-form";
import type { Category, ReviewQueueItem } from "@/lib/types/finance";
import { formatCurrency } from "@/lib/utils";

type ReviewQueueCardProps = {
  item: ReviewQueueItem;
  categories: Category[];
};

export function ReviewQueueCard({ item, categories }: ReviewQueueCardProps) {
  const [resolved, setResolved] = useState<{ persisted: boolean } | null>(null);

  if (resolved) {
    return (
      <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-4 text-sm text-emerald-50">
        <p className="font-medium">{item.merchant} — resolved</p>
        <p className="mt-1 text-emerald-100/80">
          {resolved.persisted
            ? "Removed from the queue; reflected in reports on the next warehouse refresh."
            : "Saved locally — connect a warehouse to persist this override."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-white">{item.merchant}</p>
          <p className="mt-1 text-sm text-slate-400">{item.description}</p>
          <p className="mt-1 text-xs text-slate-500">{item.reason}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-medium text-white">{formatCurrency(item.amount)}</p>
          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
            {(item.confidenceScore * 100).toFixed(0)}% confidence
          </p>
        </div>
      </div>
      <div className="mt-3 border-t border-white/5 pt-3">
        <OverrideForm
          variant="inline"
          transactionId={item.transactionId}
          currentCategoryId={item.currentCategoryId}
          suggestedCategoryLabel={item.suggestedCategory}
          categories={categories}
          onResolved={(outcome) => setResolved(outcome)}
        />
      </div>
    </div>
  );
}
