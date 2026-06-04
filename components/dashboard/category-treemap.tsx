"use client";

import { motion } from "motion/react";

import { CategorySparkline } from "@/components/dashboard/category-sparkline";
import { TrendPill } from "@/components/dashboard/trend-pill";
import {
  paletteFor,
  type CategoryPalette,
} from "@/components/dashboard/category-palette";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type CardTone,
} from "@/components/ui/card";
import type { CategoryInsight } from "@/lib/types/finance";
import {
  cn,
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
} from "@/lib/utils";

type CategoryTreemapProps = {
  categories: CategoryInsight[];
  tone?: CardTone;
};

function MerchantBars({
  merchants,
  palette,
}: {
  merchants: CategoryInsight["topMerchants"];
  palette: CategoryPalette;
}) {
  if (merchants.length === 0) {
    return null;
  }

  const max = Math.max(...merchants.map((merchant) => merchant.amount), 1);

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
        Top merchants
      </p>
      <ul className="space-y-1.5">
        {merchants.map((merchant) => (
          <li key={merchant.merchant} className="space-y-0.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-slate-300" title={merchant.merchant}>
                {merchant.merchant}
              </span>
              <span className="shrink-0 font-medium text-white">
                {formatCompactCurrency(merchant.amount)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/5">
              <div
                className={cn("h-full rounded-full", palette.bar)}
                style={{ width: `${(merchant.amount / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CategoryTreemap({
  categories,
  tone = "neutral",
}: CategoryTreemapProps) {
  const total = Math.max(
    categories.reduce((sum, category) => sum + category.amount, 0),
    1,
  );

  return (
    <Card tone={tone}>
      <CardHeader>
        <CardTitle>Category distribution</CardTitle>
        <CardDescription>
          High-signal category mix with trend, share, and top merchants per card.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {categories.map((category, index) => {
            const palette = paletteFor(category.categoryId);
            const sharePercent = Math.min(category.share, 1);

            return (
              <motion.div
                key={category.categoryId}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05, duration: 0.25 }}
                className={cn(
                  "relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] p-4 ring-1 ring-inset transition-shadow",
                  palette.ring,
                  palette.glow,
                )}
                style={{
                  minHeight: `${220 + (category.amount / total) * 160}px`,
                }}
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-30"
                  style={{
                    background: `radial-gradient(circle at 20% 0%, ${palette.from}40, transparent 60%)`,
                  }}
                />
                <div className="relative space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">
                        {category.transactionCount} transactions
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-200">
                        {category.label}
                      </p>
                    </div>
                    <TrendPill trend={category.trend} palette={palette} />
                  </div>

                  <div>
                    <p className="text-2xl font-semibold text-white">
                      {formatCurrency(category.amount)}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      avg {formatCompactCurrency(category.averageTransaction)}{" "}
                      per txn
                    </p>
                  </div>

                  <CategorySparkline
                    points={category.sparkline}
                    colors={{ stroke: palette.from, fillFrom: palette.from }}
                    uniqueId={`treemap-${category.categoryId}`}
                  />

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.2em] text-slate-500">
                      <span>Share of spend</span>
                      <span className="text-slate-300">
                        {formatPercent(category.share)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${sharePercent * 100}%` }}
                        transition={{
                          delay: index * 0.05 + 0.15,
                          duration: 0.6,
                          ease: "easeOut",
                        }}
                        className={cn("h-full rounded-full", palette.bar)}
                      />
                    </div>
                  </div>

                  <MerchantBars
                    merchants={category.topMerchants}
                    palette={palette}
                  />
                </div>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
