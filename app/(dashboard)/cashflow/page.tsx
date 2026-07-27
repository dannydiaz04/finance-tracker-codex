import { ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";

import { CashflowAlerts } from "@/components/dashboard/cashflow-alerts";
import { CashflowCategoryChart } from "@/components/dashboard/cashflow-category-chart";
import { CashflowCategoryFilter } from "@/components/dashboard/cashflow-category-filter";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { PageHeader } from "@/components/dashboard/page-header";
import { TimeFilterSummary } from "@/components/dashboard/time-filter-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { normalizeCategoryScope } from "@/lib/category-scope";
import { getCashflowAlerts } from "@/lib/queries/alerts";
import {
  getCashflowCategoryBreakdown,
  getCashflowSeries,
} from "@/lib/queries/cashflow";
import { normalizeTimeFilter } from "@/lib/time-filter";
import { formatCurrency } from "@/lib/utils";

type CashflowPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CashflowPage({ searchParams }: CashflowPageProps) {
  const resolvedSearchParams = await searchParams;
  const timeFilter = normalizeTimeFilter(resolvedSearchParams);
  const categoryIds = normalizeCategoryScope(resolvedSearchParams);
  const [cashflow, alerts, breakdown] = await Promise.all([
    getCashflowSeries(timeFilter, { categoryIds }),
    getCashflowAlerts(timeFilter),
    getCashflowCategoryBreakdown(timeFilter, { categoryIds }),
  ]);

  const inflow = cashflow.reduce((sum, point) => sum + point.inflow, 0);
  const outflow = cashflow.reduce((sum, point) => sum + point.outflow, 0);
  const net = cashflow.reduce((sum, point) => sum + point.net, 0);
  const hasCategoryScope = categoryIds.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cash flow"
        title="Watch inflow, outflow, and net movement as separate signals."
        description="This view is designed to make transfer-cleaned movement obvious, first as a category breakdown of where the money went, then across daily windows."
      />

      <TimeFilterSummary
        filter={timeFilter}
        fields="Cash flow uses `daily_cashflow.date`, a daily bucket derived from posted transactions."
      />

      <CashflowCategoryFilter
        options={breakdown.options}
        selectedCategoryIds={categoryIds}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Inflow</CardTitle>
            <ArrowUpRight className="size-4 text-emerald-400" />
          </CardHeader>
          <CardContent className="font-mono text-3xl font-semibold text-emerald-400">
            {formatCurrency(inflow)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Outflow</CardTitle>
            <ArrowDownRight className="size-4 text-red-400" />
          </CardHeader>
          <CardContent className="font-mono text-3xl font-semibold text-red-400">
            {formatCurrency(outflow)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Net</CardTitle>
            <Scale className="size-4 text-slate-400" />
          </CardHeader>
          <CardContent
            className={
              net >= 0
                ? "font-mono text-3xl font-semibold text-emerald-400"
                : "font-mono text-3xl font-semibold text-red-400"
            }
          >
            {formatCurrency(net)}
          </CardContent>
        </Card>
      </div>

      <CashflowCategoryChart
        slices={breakdown.slices}
        selectedCategoryIds={categoryIds}
      />

      <CashflowChart
        data={cashflow}
        title="Daily movement"
        description={
          hasCategoryScope
            ? "Daily inflow and outflow bars, rebuilt from transactions in the selected categories."
            : "Daily inflow and outflow bars using the warehouse mart grain."
        }
      />

      <CashflowAlerts
        result={alerts}
        tone="flow"
        description={
          hasCategoryScope
            ? "Abnormal spending, drawdown streaks, and outlier charges across every category in the current time scope — deliberately unfiltered, since a drawdown only makes sense against total money movement."
            : undefined
        }
      />
    </div>
  );
}
