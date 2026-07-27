"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  type CardTone,
} from "@/components/ui/card";
import { formatTimeFilterLabel, type TimeFilter } from "@/lib/time-filter";
import type { OverviewSnapshot } from "@/lib/types/finance";
import {
  cn,
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
  icon: typeof ArrowUpRight;
  accessor: (overview: OverviewSnapshot) => string;
  helper: (
    overview: OverviewSnapshot,
    scope: ReturnType<typeof getDateScopeCopy>,
  ) => string;
};

const kpis: KpiDefinition[] = [
  {
    key: "monthToDateIncome",
    tone: "income",
    iconAccent: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
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
    iconAccent: "border-red-500/30 bg-red-500/10 text-red-400",
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
    <div className="grid gap-4 lg:grid-cols-2">
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
                  <p className="text-xs uppercase tracking-wider text-slate-500">
                    {item.label(scope.label)}
                  </p>
                  <p
                    className={cn(
                      "mt-2 font-mono text-3xl font-semibold",
                      item.tone === "income" ? "text-emerald-400" : "text-red-400",
                    )}
                  >
                    {item.accessor(overview)}
                  </p>
                </div>
                <div className={cn("rounded-sm border p-2.5", item.iconAccent)}>
                  <Icon className="size-4" />
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-xs text-slate-500">
                {item.helper(overview, scope)}
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
