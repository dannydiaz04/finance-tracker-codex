import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type CardTone,
} from "@/components/ui/card";
import type { MonthlyFinanceSummary } from "@/lib/types/finance";
import { cn, formatCompactCurrency, formatCurrency } from "@/lib/utils";

type MonthlyMoneyChartProps = {
  summaries: MonthlyFinanceSummary[];
  selectedMonth: string | null;
  tone?: CardTone;
};

export function MonthlyMoneyChart({
  summaries,
  selectedMonth,
  tone = "neutral",
}: MonthlyMoneyChartProps) {
  const displaySummaries = [...summaries].reverse();
  const maxValue = Math.max(
    ...summaries.flatMap((summary) => [summary.income, summary.spend]),
    1,
  );

  return (
    <Card tone={tone}>
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
                "grid gap-3 rounded-sm border px-4 py-3 md:grid-cols-[140px_1fr_120px]",
                summary.month === selectedMonth
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-border bg-background",
              )}
            >
              <div>
                <p className="text-sm font-medium text-white">{summary.label}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">
                  {summary.transactionCount} transactions
                </p>
              </div>
              <div className="grid content-center gap-2">
                <div className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-xs text-slate-500">
                  <span>Income</span>
                  <div className="h-1.5 overflow-hidden bg-white/5">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${(summary.income / maxValue) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono">{formatCompactCurrency(summary.income)}</span>
                </div>
                <div className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-xs text-slate-500">
                  <span>Spend</span>
                  <div className="h-1.5 overflow-hidden bg-white/5">
                    <div
                      className="h-full bg-red-500"
                      style={{ width: `${(summary.spend / maxValue) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono">{formatCompactCurrency(summary.spend)}</span>
                </div>
              </div>
              <div className="text-left md:text-right">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  Net
                </p>
                <p
                  className={cn(
                    "mt-1 font-mono text-lg font-semibold",
                    summary.net >= 0 ? "text-emerald-400" : "text-red-400",
                  )}
                >
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
