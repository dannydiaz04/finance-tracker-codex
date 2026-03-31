import { ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";

import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCashflowSeries } from "@/lib/queries/cashflow";
import { formatCurrency } from "@/lib/utils";

export default async function CashflowPage() {
  const cashflow = await getCashflowSeries();

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

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Inflow</CardTitle>
            <ArrowUpRight className="size-4 text-emerald-300" />
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-white">
            {formatCurrency(inflow)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Outflow</CardTitle>
            <ArrowDownRight className="size-4 text-fuchsia-300" />
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-white">
            {formatCurrency(outflow)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Net</CardTitle>
            <Scale className="size-4 text-cyan-300" />
          </CardHeader>
          <CardContent className="text-3xl font-semibold text-white">
            {formatCurrency(net)}
          </CardContent>
        </Card>
      </div>

      <CashflowChart
        data={cashflow}
        title="Daily movement"
        description="Daily inflow and outflow bars using the warehouse mart grain."
      />
    </div>
  );
}
