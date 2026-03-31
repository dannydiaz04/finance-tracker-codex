"use client";

import { motion } from "motion/react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CashflowPoint } from "@/lib/types/finance";
import { formatCompactCurrency, formatDateLabel } from "@/lib/utils";

type CashflowChartProps = {
  data: CashflowPoint[];
  title?: string;
  description?: string;
};

export function CashflowChart({
  data,
  title = "Cash flow pulse",
  description = "Recent inflow and outflow cadence from the warehouse mart.",
}: CashflowChartProps) {
  const maxValue = Math.max(
    ...data.flatMap((item) => [item.inflow, item.outflow, Math.abs(item.net)]),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3">
          {data.map((point, index) => (
            <motion.div
              key={point.date}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.03, duration: 0.25 }}
              className="grid gap-3 md:grid-cols-[140px_1fr_100px]"
            >
              <div className="text-sm text-slate-400">{formatDateLabel(point.date)}</div>
              <div className="space-y-2">
                <div className="h-2 overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-blue-500"
                    style={{ width: `${(point.inflow / maxValue) * 100}%` }}
                  />
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/6">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 to-violet-500"
                    style={{ width: `${(point.outflow / maxValue) * 100}%` }}
                  />
                </div>
              </div>
              <div className="text-right text-sm text-slate-300">
                {formatCompactCurrency(point.net)}
              </div>
            </motion.div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
