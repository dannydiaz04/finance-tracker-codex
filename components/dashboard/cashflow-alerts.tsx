import { CircleAlert, Info, ShieldCheck, TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  type CardTone,
} from "@/components/ui/card";
import type {
  CashflowAlert,
  CashflowAlertSeverity,
  CashflowAlertsResult,
} from "@/lib/alerts/cashflow-anomalies";
import { cn, formatCurrency } from "@/lib/utils";

type CashflowAlertsProps = {
  result: CashflowAlertsResult;
  tone?: CardTone;
  title?: string;
  description?: string;
};

const severityStyles: Record<
  CashflowAlertSeverity,
  { wrapper: string; badge: string; icon: typeof CircleAlert; label: string }
> = {
  critical: {
    wrapper: "border-rose-400/30 bg-rose-400/10",
    badge: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    icon: TriangleAlert,
    label: "critical",
  },
  warning: {
    wrapper: "border-amber-400/30 bg-amber-400/10",
    badge: "border-amber-400/30 bg-amber-400/10 text-amber-100",
    icon: CircleAlert,
    label: "warning",
  },
  info: {
    wrapper: "border-cyan-400/30 bg-cyan-400/10",
    badge: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
    icon: Info,
    label: "info",
  },
};

function AlertRow({ alert }: { alert: CashflowAlert }) {
  const style = severityStyles[alert.severity];
  const Icon = style.icon;

  return (
    <div className={cn("rounded-2xl border p-4", style.wrapper)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 size-4 shrink-0 text-slate-100" />
          <div>
            <p className="font-medium text-white">{alert.title}</p>
            <p className="mt-1 text-sm text-slate-300">{alert.detail}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold text-white">{formatCurrency(alert.amount)}</p>
          <Badge className={cn("mt-2", style.badge)}>{style.label}</Badge>
        </div>
      </div>
    </div>
  );
}

export function CashflowAlerts({
  result,
  tone = "review",
  title = "Cash flow alerts",
  description = "Abnormal spending, drawdown streaks, and outlier charges in the current time scope.",
}: CashflowAlertsProps) {
  const { alerts, summary } = result;

  return (
    <Card tone={tone}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-2">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {summary.total > 0 ? (
          <Badge
            className={
              summary.critical > 0
                ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
                : "border-amber-400/30 bg-amber-400/10 text-amber-100"
            }
          >
            {summary.total} {summary.total === 1 ? "alert" : "alerts"}
          </Badge>
        ) : (
          <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-200">
            all clear
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4 text-sm text-emerald-100">
            <ShieldCheck className="size-4" />
            No abnormal cash flow detected in this window.
          </div>
        ) : (
          alerts.map((alert) => <AlertRow key={alert.id} alert={alert} />)
        )}
      </CardContent>
    </Card>
  );
}
