"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatTimeFilterLabel, type TimeFilter } from "@/lib/time-filter";
import type { OverviewSnapshot } from "@/lib/types/finance";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/utils";

type KpiCardsProps = {
  overview: OverviewSnapshot;
  timeFilter: TimeFilter;
};

function getDateScopeCopy(filter: TimeFilter) {
  const label = formatTimeFilterLabel(filter);

  if (!filter.from && !filter.to && !filter.month) {
    return {
      label,
      activityPhrase: "across all available dates",
      contextPhrase: "all available dates",
    };
  }

  return {
    label,
    activityPhrase: `dated ${label}`,
    contextPhrase: label,
  };
}

const kpis = [
  {
    key: "totalBalance",
    label: (scope: string) => `Net worth (${scope})`,
    icon: Wallet,
    accessor: (overview: OverviewSnapshot) =>
      formatCompactCurrency(overview.totalBalance),
    helper: (_overview: OverviewSnapshot, scope: ReturnType<typeof getDateScopeCopy>) =>
      `Current linked account balances, shown with ${scope.contextPhrase} context.`,
  },
  {
    key: "monthToDateIncome",
    label: (scope: string) => `Income (${scope})`,
    icon: ArrowUpRight,
    accessor: (overview: OverviewSnapshot) =>
      formatCurrency(overview.monthToDateIncome),
    helper: (_overview: OverviewSnapshot, scope: ReturnType<typeof getDateScopeCopy>) =>
      `Posted income ${scope.activityPhrase}.`,
  },
  {
    key: "monthToDateSpend",
    label: (scope: string) => `Spend (${scope})`,
    icon: ArrowDownRight,
    accessor: (overview: OverviewSnapshot) =>
      formatCurrency(overview.monthToDateSpend),
    helper: (overview: OverviewSnapshot, scope: ReturnType<typeof getDateScopeCopy>) =>
      `Savings rate ${formatPercent(overview.savingsRate)} for posted activity ${scope.activityPhrase}.`,
  },
];

export function KpiCards({ overview, timeFilter }: KpiCardsProps) {
  const scope = getDateScopeCopy(timeFilter);

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {kpis.map((item, index) => {
        const Icon = item.icon;

        return (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.35 }}
          >
            <Card className="h-full">
              <CardHeader className="flex-row items-start justify-between gap-4 pb-4">
                <div>
                  <p className="text-sm text-slate-400">{item.label(scope.label)}</p>
                  <CardTitle className="mt-2 text-3xl">
                    {item.accessor(overview)}
                  </CardTitle>
                </div>
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-200">
                  <Icon className="size-5" />
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-slate-400">
                {item.helper(overview, scope)}
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
