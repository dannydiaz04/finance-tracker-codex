import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MonthlyFinanceSummary } from "@/lib/types/finance";
import { cn, formatCompactCurrency, formatCurrency } from "@/lib/utils";

type MonthlyMoneyChartProps = {
  summaries: MonthlyFinanceSummary[];
  selectedMonth: string | null;
};

export function MonthlyMoneyChart({
  summaries,
  selectedMonth,
}: MonthlyMoneyChartProps) {
  const displaySummaries = [...summaries].reverse();
  const maxValue = Math.max(
    ...summaries.flatMap((summary) => [summary.income, summary.spend]),
    1,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monthly money movement</CardTitle>
        <CardDescription>
          Income and spending by posted transaction month.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {displaySummaries.map((summary) => (
            <div
              key={summary.month}
              className={cn(
                "grid gap-3 rounded-2xl border px-4 py-4 md:grid-cols-[140px_1fr_120px]",
                summary.month === selectedMonth
                  ? "border-cyan-300/30 bg-cyan-400/10"
                  : "border-white/10 bg-white/[0.03]",
              )}
            >
              <div>
                <p className="text-sm font-medium text-white">{summary.label}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                  {summary.transactionCount} txns
                </p>
              </div>
              <div className="grid content-center gap-2">
                <div className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-xs text-slate-400">
                  <span>Income</span>
                  <div className="h-2 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-emerald-300"
                      style={{ width: `${(summary.income / maxValue) * 100}%` }}
                    />
                  </div>
                  <span>{formatCompactCurrency(summary.income)}</span>
                </div>
                <div className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-xs text-slate-400">
                  <span>Spend</span>
                  <div className="h-2 overflow-hidden rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full bg-fuchsia-300"
                      style={{ width: `${(summary.spend / maxValue) * 100}%` }}
                    />
                  </div>
                  <span>{formatCompactCurrency(summary.spend)}</span>
                </div>
              </div>
              <div className="text-left md:text-right">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  Net
                </p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {formatCurrency(summary.net)}
                </p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
