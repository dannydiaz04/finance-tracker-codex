import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type CardTone,
} from "@/components/ui/card";
import type { WeekdaySpendInsight } from "@/lib/types/finance";
import { cn, formatCurrency, formatPercent } from "@/lib/utils";

type WeekdaySpendChartProps = {
  weekdays: WeekdaySpendInsight[];
  tone?: CardTone;
};

export function WeekdaySpendChart({
  weekdays,
  tone = "neutral",
}: WeekdaySpendChartProps) {
  const maxSpend = Math.max(...weekdays.map((weekday) => weekday.spend), 1);
  const most = weekdays.reduce((current, weekday) =>
    weekday.spend > current.spend ? weekday : current,
  );
  const least = weekdays.reduce((current, weekday) =>
    weekday.spend < current.spend ? weekday : current,
  );

  return (
    <Card tone={tone}>
      <CardHeader>
        <CardTitle>Spend by weekday</CardTitle>
        <CardDescription>
          Posted expenses grouped by day of week.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-sm border border-red-500/30 bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">Most spend</p>
              <ArrowUp className="size-4 text-red-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-white">
              {most.weekday}
            </p>
            <p className="mt-1 font-mono text-sm text-red-400">
              {formatCurrency(most.spend)}
            </p>
          </div>
          <div className="rounded-sm border border-emerald-500/30 bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-wider text-slate-500">Least spend</p>
              <ArrowDown className="size-4 text-emerald-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-white">
              {least.weekday}
            </p>
            <p className="mt-1 font-mono text-sm text-emerald-400">
              {formatCurrency(least.spend)}
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {weekdays.map((weekday) => (
            <div
              key={weekday.weekday}
              className="grid gap-2 md:grid-cols-[96px_1fr_92px]"
            >
              <div>
                <p className="text-sm font-medium text-white">{weekday.weekday}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {weekday.transactionCount} transactions
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden bg-white/5">
                  <div
                    className={cn(
                      "h-full",
                      weekday.weekday === most.weekday
                        ? "bg-red-500"
                        : weekday.weekday === least.weekday
                          ? "bg-emerald-500"
                          : "bg-slate-600",
                    )}
                    style={{ width: `${(weekday.spend / maxSpend) * 100}%` }}
                  />
                </div>
                <Badge>{formatPercent(weekday.share)}</Badge>
              </div>
              <div className="text-left font-mono text-sm font-medium text-white md:text-right">
                {formatCurrency(weekday.spend)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
