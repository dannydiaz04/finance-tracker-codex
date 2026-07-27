"use client";

import { motion } from "motion/react";

import { useCategoryScope } from "@/components/dashboard/use-category-scope";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type CardTone,
} from "@/components/ui/card";
import { isolateCategoryScope } from "@/lib/category-scope";
import type { CashflowCategorySlice } from "@/lib/types/finance";
import {
  cn,
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
} from "@/lib/utils";

type CashflowCategoryChartProps = {
  slices: CashflowCategorySlice[];
  selectedCategoryIds: string[];
  tone?: CardTone;
};

/* Heaviest outflow reads hottest, tapering to slate so the long tail stays legible. */
const rankTones = [
  { bar: "bg-red-500", text: "text-red-400" },
  { bar: "bg-red-400", text: "text-red-300" },
  { bar: "bg-amber-500", text: "text-amber-400" },
  { bar: "bg-amber-400", text: "text-amber-300" },
  { bar: "bg-slate-400", text: "text-slate-300" },
  { bar: "bg-slate-500", text: "text-slate-400" },
  { bar: "bg-slate-600", text: "text-slate-400" },
];

function toneForRank(rank: number) {
  return rankTones[Math.min(rank, rankTones.length - 1)];
}

export function CashflowCategoryChart({
  slices,
  selectedCategoryIds,
  tone = "category",
}: CashflowCategoryChartProps) {
  const { setScope, isPending } = useCategoryScope();
  const totalOutflow = slices.reduce((sum, slice) => sum + slice.outflow, 0);
  const maxValue = Math.max(
    ...slices.flatMap((slice) => [slice.outflow, slice.inflow]),
    1,
  );
  const composition = slices.filter((slice) => slice.outflow > 0);

  return (
    <Card tone={tone}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Where the money went</CardTitle>
          <CardDescription>
            Cash flow split by subcategory for the current scope. Transfers and card
            payments are excluded, so every bar is money that actually left or
            entered. Select a subcategory to narrow the whole page to it.
          </CardDescription>
        </div>
        <Badge className="shrink-0 border-red-500/40 text-red-400">
          {formatCompactCurrency(totalOutflow)} out
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {slices.length === 0 ? (
          <div className="rounded-sm border border-border bg-background p-4 text-sm text-slate-400">
            No categorized movement in this scope. Widen the time range or clear
            the subcategory filter.
          </div>
        ) : (
          <>
            {composition.length > 0 ? (
              <div className="space-y-2">
                <div className="flex h-3 w-full gap-px overflow-hidden bg-white/5">
                  {composition.map((slice, index) => (
                    <motion.div
                      key={slice.categoryId}
                      initial={{ width: 0 }}
                      animate={{ width: `${slice.outflowShare * 100}%` }}
                      transition={{ duration: 0.5, ease: "easeOut" }}
                      className={cn("h-full", toneForRank(index).bar)}
                      title={`${slice.label} — ${formatCurrency(slice.outflow)} (${formatPercent(slice.outflowShare)})`}
                    />
                  ))}
                </div>
                <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                  Outflow composition · {composition.length}{" "}
                  {composition.length === 1 ? "subcategory" : "subcategories"}
                </p>
              </div>
            ) : null}

            <div
              className={cn(
                "grid gap-1 transition-opacity",
                isPending && "opacity-60",
              )}
            >
              {slices.map((slice, index) => {
                const rankTone = toneForRank(index);
                const isSelected = selectedCategoryIds.includes(
                  slice.categoryId,
                );

                return (
                  <motion.button
                    key={slice.categoryId}
                    type="button"
                    disabled={isPending}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.03, duration: 0.25 }}
                    onClick={() =>
                      setScope(
                        isolateCategoryScope(
                          selectedCategoryIds,
                          slice.categoryId,
                        ),
                      )
                    }
                    aria-pressed={isSelected}
                    className={cn(
                      "grid w-full gap-2 rounded-sm border p-2 text-left transition-colors disabled:cursor-not-allowed md:grid-cols-[minmax(0,168px)_minmax(0,1fr)_112px] md:items-center",
                      isSelected
                        ? "border-emerald-500/50 bg-emerald-500/[0.06]"
                        : "border-transparent hover:border-border hover:bg-white/[0.03]",
                    )}
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-medium text-white"
                        title={slice.label}
                      >
                        {slice.label}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {slice.transactionCount}{" "}
                        {slice.transactionCount === 1 ? "txn" : "txns"}
                        {slice.averageOutflow > 0
                          ? ` · avg ${formatCompactCurrency(slice.averageOutflow)}`
                          : ""}
                      </p>
                    </div>

                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 overflow-hidden bg-white/5">
                          <div
                            className={cn("h-full", rankTone.bar)}
                            style={{
                              width: `${(slice.outflow / maxValue) * 100}%`,
                            }}
                          />
                        </div>
                        <Badge className="shrink-0">
                          {formatPercent(slice.outflowShare)}
                        </Badge>
                      </div>

                      {slice.inflow > 0 ? (
                        <div className="flex items-center gap-3">
                          <div className="h-1 flex-1 overflow-hidden bg-white/5">
                            <div
                              className="h-full bg-emerald-500"
                              style={{
                                width: `${(slice.inflow / maxValue) * 100}%`,
                              }}
                            />
                          </div>
                          <span className="shrink-0 font-mono text-[10px] text-emerald-400">
                            +{formatCompactCurrency(slice.inflow)}
                          </span>
                        </div>
                      ) : null}

                      {slice.topMerchants.length > 0 ? (
                        <p className="truncate text-[11px] text-slate-500">
                          {slice.topMerchants
                            .map(
                              (merchant) =>
                                `${merchant.merchant} ${formatCompactCurrency(merchant.amount)}`,
                            )
                            .join(" · ")}
                        </p>
                      ) : null}
                    </div>

                    <div className="md:text-right">
                      <p className="font-mono text-sm font-medium text-white">
                        {formatCurrency(slice.outflow)}
                      </p>
                      <p
                        className={cn(
                          "mt-0.5 font-mono text-[11px]",
                          slice.net >= 0 ? "text-emerald-400" : "text-slate-500",
                        )}
                      >
                        net {formatCompactCurrency(slice.net)}
                      </p>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
