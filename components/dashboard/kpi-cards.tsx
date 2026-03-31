"use client";

import { motion } from "motion/react";
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewSnapshot } from "@/lib/types/finance";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/utils";

type KpiCardsProps = {
  overview: OverviewSnapshot;
};

const kpis = [
  {
    key: "totalBalance",
    label: "Net worth surface",
    icon: Wallet,
    accessor: (overview: OverviewSnapshot) =>
      formatCompactCurrency(overview.totalBalance),
    helper: "Current across linked cash and credit accounts.",
  },
  {
    key: "monthToDateIncome",
    label: "Income MTD",
    icon: ArrowUpRight,
    accessor: (overview: OverviewSnapshot) =>
      formatCurrency(overview.monthToDateIncome),
    helper: "Classified after transfer and refund cleanup.",
  },
  {
    key: "monthToDateSpend",
    label: "Spend MTD",
    icon: ArrowDownRight,
    accessor: (overview: OverviewSnapshot) =>
      formatCurrency(overview.monthToDateSpend),
    helper: (overview: OverviewSnapshot) =>
      `Savings rate ${formatPercent(overview.savingsRate)} this month.`,
  },
];

export function KpiCards({ overview }: KpiCardsProps) {
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
                  <p className="text-sm text-slate-400">{item.label}</p>
                  <CardTitle className="mt-2 text-3xl">
                    {item.accessor(overview)}
                  </CardTitle>
                </div>
                <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-200">
                  <Icon className="size-5" />
                </div>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-slate-400">
                {typeof item.helper === "function" ? item.helper(overview) : item.helper}
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </div>
  );
}
