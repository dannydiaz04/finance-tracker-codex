import { ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";

import { CashflowAlerts } from "@/components/dashboard/cashflow-alerts";
import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { PageHeader } from "@/components/dashboard/page-header";
import { TimeFilterSummary } from "@/components/dashboard/time-filter-summary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCashflowAlerts } from "@/lib/queries/alerts";
import { getCashflowSeries } from "@/lib/queries/cashflow";
import { normalizeTimeFilter } from "@/lib/time-filter";
import { formatCurrency } from "@/lib/utils";

type CashflowPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function CashflowPage({ searchParams }: CashflowPageProps) {
  const timeFilter = normalizeTimeFilter(await searchParams);
  const [cashflow, alerts] = await Promise.all([
    getCashflowSeries(timeFilter),
    getCashflowAlerts(timeFilter),
  ]);

  const inflow = cashflow.reduce((sum, point) => sum + point.inflow, 0);
  const outflow = cashflow.reduce((sum, point) => sum + point.outflow, 0);
  const net = cashflow.reduce((sum, point) => sum + point.net, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Cash flow"
        title="Watch inflow, outflow, and net movement as separate signals."
        description="This view is designed to make transfer-cleaned movement obvious across daily windows before you move into merchant or category detail."
      />

      <TimeFilterSummary
        filter={timeFilter}
        fields="Cash flow uses `daily_cashflow.date`, a daily bucket derived from posted transactions."
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

      <CashflowChart
        data={cashflow}
        title="Daily movement"
        description="Daily inflow and outflow bars using the warehouse mart grain."
      />

      <CashflowAlerts result={alerts} tone="flow" />
    </div>
  );
}
