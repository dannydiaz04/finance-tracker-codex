"use client";

import { motion } from "motion/react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CategoryInsight } from "@/lib/types/finance";
import { formatCurrency, formatPercent } from "@/lib/utils";

type CategoryTreemapProps = {
  categories: CategoryInsight[];
};

export function CategoryTreemap({ categories }: CategoryTreemapProps) {
  const total = Math.max(
    categories.reduce((sum, category) => sum + category.amount, 0),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Category distribution</CardTitle>
        <CardDescription>
          High-signal category mix with trend context and spend share.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {categories.map((category, index) => (
            <motion.div
              key={category.categoryId}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: index * 0.05, duration: 0.25 }}
              className="rounded-3xl border border-white/10 bg-white/[0.04] p-4"
              style={{
                minHeight: `${120 + (category.amount / total) * 180}px`,
              }}
            >
              <p className="text-sm text-slate-400">{category.label}</p>
              <p className="mt-3 text-2xl font-semibold text-white">
                {formatCurrency(category.amount)}
              </p>
              <div className="mt-6 flex items-end justify-between text-xs uppercase tracking-[0.2em] text-slate-500">
                <span>{formatPercent(category.share)}</span>
                <span>{category.transactionCount} txns</span>
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
