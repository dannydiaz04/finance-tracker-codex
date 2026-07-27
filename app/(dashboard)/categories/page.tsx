import { CircleCheckBig } from "lucide-react";

import { CategoryGroupManager } from "@/components/categories/category-group-manager";
import { CategoryManager } from "@/components/categories/category-manager";
import { CategoryHitRateList } from "@/components/dashboard/category-hit-rate-list";
import { CategoryTreemap } from "@/components/dashboard/category-treemap";
import { PageHeader } from "@/components/dashboard/page-header";
import { TimeFilterSummary } from "@/components/dashboard/time-filter-summary";
import { ReviewQueueCard } from "@/components/rules/review-queue-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCategories, getCategoryGroups } from "@/lib/queries/catalog";
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
  const categoryGroups = await getCategoryGroups(categoryOptions);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Categories"
        title="Deterministic categorization first, review queue second."
        description="Subcategories are assigned by warehouse rules, institution hints, and user overrides, with low-confidence rows isolated for fast correction."
        action={
          <div className="flex flex-wrap gap-2">
            <CategoryGroupManager
              categoryGroups={categoryGroups}
              subcategories={categoryOptions}
            />
            <CategoryManager
              categories={categoryOptions}
              categoryGroups={categoryGroups}
            />
          </div>
        }
      />

      <TimeFilterSummary
        filter={timeFilter}
        fields="Subcategory spend and review rows use transaction `postedAt` / warehouse `posted_at`."
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
              categoryGroups={categoryGroups}
            />
          ))}

          <div className="rounded-sm border border-emerald-500/30 bg-background p-4 text-sm text-emerald-400">
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
