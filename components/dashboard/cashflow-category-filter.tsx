"use client";

import { Layers, RotateCcw } from "lucide-react";

import { useCategoryScope } from "@/components/dashboard/use-category-scope";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toggleCategoryScope } from "@/lib/category-scope";
import type { CashflowCategorySlice } from "@/lib/types/finance";
import { cn, formatCompactCurrency } from "@/lib/utils";

type CashflowCategoryFilterProps = {
  options: CashflowCategorySlice[];
  selectedCategoryIds: string[];
};

export function CashflowCategoryFilter({
  options,
  selectedCategoryIds,
}: CashflowCategoryFilterProps) {
  const { setScope, isPending } = useCategoryScope();
  const selectedCount = selectedCategoryIds.length;

  return (
    <div className="rounded-sm border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3 text-sm">
          <Layers className="mt-0.5 size-4 shrink-0 text-emerald-500" />
          <div>
            <p className="font-medium text-white">
              {selectedCount === 0
                ? "All categories"
                : `${selectedCount} of ${options.length} categories`}
            </p>
            <p className="mt-1 text-slate-400">
              Category scope applies to the totals, the daily chart, and the
              breakdown below, on top of the active time range.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isPending ? <Spinner label="Updating visuals…" /> : null}
          {selectedCount > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isPending}
              onClick={() => setScope([])}
            >
              <RotateCcw className="mr-2 size-3.5" />
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {options.length > 0 ? (
        <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
          {options.map((option) => {
            const isSelected = selectedCategoryIds.includes(option.categoryId);

            return (
              <button
                key={option.categoryId}
                type="button"
                disabled={isPending}
                aria-pressed={isSelected}
                onClick={() =>
                  setScope(
                    toggleCategoryScope(selectedCategoryIds, option.categoryId),
                  )
                }
                className={cn(
                  "inline-flex items-center gap-2 rounded-sm border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  isSelected
                    ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
                    : "border-border text-slate-400 hover:bg-white/[0.04] hover:text-white",
                )}
              >
                <span className="max-w-[14rem] truncate">{option.label}</span>
                <span className="font-mono text-[10px] text-slate-500">
                  {formatCompactCurrency(option.outflow)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
