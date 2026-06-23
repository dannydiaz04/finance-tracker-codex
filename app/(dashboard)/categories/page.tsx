import { CircleCheckBig } from "lucide-react";

import { CategoryManager } from "@/components/categories/category-manager";
import { CategoryHitRateList } from "@/components/dashboard/category-hit-rate-list";
import { CategoryTreemap } from "@/components/dashboard/category-treemap";
import { PageHeader } from "@/components/dashboard/page-header";
import { TimeFilterSummary } from "@/components/dashboard/time-filter-summary";
import { ReviewQueueCard } from "@/components/rules/review-queue-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCategories } from "@/lib/queries/catalog";
import { getCategoryInsights, getReviewQueue } from "@/lib/queries/categories";
import { normalizeTimeFilter } from "@/lib/time-filter";

type CategoriesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CategoriesPage({
  searchParams,
}: CategoriesPageProps) {
  const timeFilter = normalizeTimeFilter(await searchParams);
  const [categories, reviewQueue, categoryOptions] = await Promise.all([
    getCategoryInsights(timeFilter),
    getReviewQueue(timeFilter),
    getCategories(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Categories"
        title="Deterministic categorization first, review queue second."
        description="Categories are derived from warehouse rules, institution hints, and user overrides, with low-confidence rows isolated for fast correction."
        action={<CategoryManager categories={categoryOptions} />}
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
            <ReviewQueueCard
              key={item.transactionId}
              item={item}
              categories={categoryOptions}
            />
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
