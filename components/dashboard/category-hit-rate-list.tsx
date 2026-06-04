import { CategorySparkline } from "@/components/dashboard/category-sparkline";
import { paletteFor } from "@/components/dashboard/category-palette";
import { TrendPill } from "@/components/dashboard/trend-pill";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CategoryInsight } from "@/lib/types/finance";
import { cn, formatCompactCurrency, formatPercent } from "@/lib/utils";

type CategoryHitRateListProps = {
  categories: CategoryInsight[];
};

export function CategoryHitRateList({ categories }: CategoryHitRateListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rule hit-rate snapshot</CardTitle>
        <CardDescription>
          Share of classified spend with daily cadence and recent trend per
          category.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {categories.map((category) => {
          const palette = paletteFor(category.categoryId);
          const sharePercent = Math.min(category.share, 1);

          return (
            <div
              key={category.categoryId}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-full"
                    style={{
                      background: `linear-gradient(135deg, ${palette.from}, ${palette.to})`,
                      boxShadow: `0 0 12px ${palette.from}80`,
                    }}
                  />
                  <p className="text-sm font-medium text-white">
                    {category.label}
                  </p>
                </div>
                <TrendPill trend={category.trend} palette={palette} />
              </div>

              <div className="mt-3 grid grid-cols-[1fr_72px] items-center gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    <span>{category.transactionCount} rows</span>
                    <span className="text-slate-300">
                      {formatPercent(category.share)}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div
                      className={cn("h-full rounded-full", palette.bar)}
                      style={{ width: `${sharePercent * 100}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {formatCompactCurrency(category.amount)} classified
                  </p>
                </div>
                <CategorySparkline
                  points={category.sparkline}
                  colors={{ stroke: palette.from, fillFrom: palette.from }}
                  uniqueId={`hitrate-${category.categoryId}`}
                  height={28}
                  className="h-8 w-full"
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
