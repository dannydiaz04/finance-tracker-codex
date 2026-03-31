import { ArrowUpRight, CircleAlert, Wallet2 } from "lucide-react";

import { CashflowChart } from "@/components/dashboard/cashflow-chart";
import { CategoryTreemap } from "@/components/dashboard/category-treemap";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCategoryInsights } from "@/lib/queries/categories";
import { getMerchantInsights } from "@/lib/queries/merchants";
import { getOverviewSnapshot } from "@/lib/queries/overview";
import { formatCompactCurrency, formatCurrency } from "@/lib/utils";

export default async function OverviewPage() {
  const [overview, categories, merchants] = await Promise.all([
    getOverviewSnapshot(),
    getCategoryInsights(),
    getMerchantInsights(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Overview"
        title="A finance cockpit built for transaction-level analysis."
        description="This dashboard is optimized for fast personal review: current balance posture, month-to-date movement, category concentration, and the next transactions that deserve attention."
        action={
          <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-5 py-4 text-right">
            <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
              Review queue
            </p>
            <p className="mt-2 text-3xl font-semibold text-white">
              {overview.reviewQueueCount}
            </p>
          </div>
        }
      />

      <KpiCards overview={overview} />

      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <CashflowChart data={overview.cashflow} />

        <Card>
          <CardHeader>
            <CardTitle>Largest current mover</CardTitle>
            <CardDescription>
              Highest magnitude classified expense for the active month.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm text-slate-400">
                    {overview.largestExpense.merchant}
                  </p>
                  <p className="mt-2 text-3xl font-semibold text-white">
                    {formatCurrency(-overview.largestExpense.amount)}
                  </p>
                </div>
                <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-400/10 p-3 text-fuchsia-200">
                  <ArrowUpRight className="size-5" />
                </div>
              </div>
              <p className="mt-4 text-sm text-slate-400">
                Posted {overview.largestExpense.postedAt}
              </p>
            </div>

            <div className="space-y-3">
              {overview.accounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"
                >
                  <div>
                    <p className="font-medium text-white">{account.name}</p>
                    <p className="text-sm text-slate-400">{account.institution}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium text-white">
                      {formatCompactCurrency(account.currentBalance)}
                    </p>
                    <p className="text-sm text-slate-400">
                      available {formatCompactCurrency(account.availableBalance)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <CategoryTreemap categories={categories} />

        <Card>
          <CardHeader>
            <CardTitle>Top merchants</CardTitle>
            <CardDescription>
              Merchant concentration over the current rolling window.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {merchants.map((merchant) => (
              <div
                key={merchant.merchant}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">{merchant.merchant}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {merchant.likelyRecurring ? (
                        <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-100">
                          recurring
                        </Badge>
                      ) : null}
                      <Badge>{merchant.transactions} transactions</Badge>
                    </div>
                  </div>
                  <p className="text-right text-lg font-semibold text-white">
                    {formatCurrency(merchant.spend)}
                  </p>
                </div>
              </div>
            ))}

            <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-50">
              <div className="flex items-center gap-2">
                <CircleAlert className="size-4" />
                Transfer and fee categories still share one placeholder bucket in the
                sample dataset. The rules pipeline is ready to split those cleanly.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <Wallet2 className="size-5 text-cyan-300" />
            <div>
              <CardTitle className="text-base">Available cash</CardTitle>
              <CardDescription>
                Liquid balances across non-credit accounts.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-white">
              {formatCurrency(overview.availableCash)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review posture</CardTitle>
            <CardDescription>
              Pending AI suggestions and low-confidence rows to confirm.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold text-white">
              {overview.reviewQueueCount} items
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
