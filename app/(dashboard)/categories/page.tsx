import { CircleCheckBig } from "lucide-react";

import { CategoryTreemap } from "@/components/dashboard/category-treemap";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCategoryInsights, getReviewQueue } from "@/lib/queries/categories";
import { formatCurrency, formatPercent } from "@/lib/utils";

export default async function CategoriesPage() {
  const [categories, reviewQueue] = await Promise.all([
    getCategoryInsights(),
    getReviewQueue(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Categories"
        title="Deterministic categorization first, review queue second."
        description="Categories are derived from warehouse rules, institution hints, and user overrides, with low-confidence rows isolated for fast correction."
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <CategoryTreemap categories={categories} />

        <Card>
          <CardHeader>
            <CardTitle>Rule hit-rate snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {categories.map((category) => (
              <div
                key={category.categoryId}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <p className="font-medium text-white">{category.label}</p>
                  <Badge>{formatPercent(category.share)}</Badge>
                </div>
                <div className="mt-3 flex items-center justify-between text-sm text-slate-400">
                  <span>{category.transactionCount} classified rows</span>
                  <span>trend {formatPercent(category.trend)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Review queue</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reviewQueue.map((item) => (
            <div
              key={item.transactionId}
              className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4 md:grid-cols-[1fr_auto_auto]"
            >
              <div>
                <p className="font-medium text-white">{item.merchant}</p>
                <p className="mt-1 text-sm text-slate-400">{item.reason}</p>
              </div>
              <div className="text-sm text-slate-300">
                {item.suggestedCategory}
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                  confidence {(item.confidenceScore * 100).toFixed(0)}%
                </p>
              </div>
              <div className="text-right font-medium text-white">
                {formatCurrency(item.amount)}
              </div>
            </div>
          ))}

          <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-50">
            <div className="flex items-center gap-2">
              <CircleCheckBig className="size-4" />
              User corrections land in `manual_overrides`, then replay into the
              canonical fact table on the next transformation pass.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
