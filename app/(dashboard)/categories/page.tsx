import { CircleCheckBig } from "lucide-react";

import { CategoryHitRateList } from "@/components/dashboard/category-hit-rate-list";
import { CategoryTreemap } from "@/components/dashboard/category-treemap";
import { PageHeader } from "@/components/dashboard/page-header";
import { TimeFilterSummary } from "@/components/dashboard/time-filter-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCategoryInsights, getReviewQueue } from "@/lib/queries/categories";
import { normalizeTimeFilter } from "@/lib/time-filter";
import { formatCurrency } from "@/lib/utils";

type CategoriesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CategoriesPage({
  searchParams,
}: CategoriesPageProps) {
  const timeFilter = normalizeTimeFilter(await searchParams);
  const [categories, reviewQueue] = await Promise.all([
    getCategoryInsights(timeFilter),
    getReviewQueue(timeFilter),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Categories"
        title="Deterministic categorization first, review queue second."
        description="Categories are derived from warehouse rules, institution hints, and user overrides, with low-confidence rows isolated for fast correction."
      />

      <TimeFilterSummary
        filter={timeFilter}
        fields="Category spend and review rows use transaction `postedAt` / warehouse `posted_at`."
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <CategoryTreemap categories={categories} />
        <CategoryHitRateList categories={categories} />
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
