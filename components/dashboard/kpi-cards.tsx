"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  type CardTone,
} from "@/components/ui/card";
import { formatTimeFilterLabel, type TimeFilter } from "@/lib/time-filter";
import type { OverviewSnapshot } from "@/lib/types/finance";
import {
  cn,
  formatCompactCurrency,
  formatCurrency,
  formatPercent,
} from "@/lib/utils";

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

type KpiDefinition = {
  key: string;
  tone: CardTone;
  iconAccent: string;
  label: (scope: string) => string;
  icon: typeof Wallet;
  accessor: (overview: OverviewSnapshot) => string;
  helper: (
    overview: OverviewSnapshot,
    scope: ReturnType<typeof getDateScopeCopy>,
  ) => string;
};

const kpis: KpiDefinition[] = [
  {
    key: "totalBalance",
    tone: "balance",
    iconAccent: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
    label: (scope: string) => `Net worth (${scope})`,
    icon: Wallet,
    accessor: (overview: OverviewSnapshot) =>
      formatCompactCurrency(overview.totalBalance),
    helper: (_overview: OverviewSnapshot, scope: ReturnType<typeof getDateScopeCopy>) =>
      `Current linked account balances, shown with ${scope.contextPhrase} context.`,
  },
  {
    key: "monthToDateIncome",
    tone: "income",
    iconAccent: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
    label: (scope: string) => `Income (${scope})`,
    icon: ArrowUpRight,
    accessor: (overview: OverviewSnapshot) =>
      formatCurrency(overview.monthToDateIncome),
    helper: (_overview: OverviewSnapshot, scope: ReturnType<typeof getDateScopeCopy>) =>
      `Posted income ${scope.activityPhrase}.`,
  },
  {
    key: "monthToDateSpend",
    tone: "spend",
    iconAccent: "border-fuchsia-400/30 bg-fuchsia-400/10 text-fuchsia-200",
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
            <Card className="h-full" tone={item.tone}>
              <CardHeader className="flex-row items-start justify-between gap-4 pb-4">
                <div>
                  <p className="text-sm text-slate-400">{item.label(scope.label)}</p>
                  <CardTitle className="mt-2 text-3xl">
                    {item.accessor(overview)}
                  </CardTitle>
                </div>
                <div className={cn("rounded-2xl border p-3", item.iconAccent)}>
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
