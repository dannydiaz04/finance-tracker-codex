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
    wrapper: "border-red-500/40",
    badge: "border-red-500/40 text-red-400",
    icon: TriangleAlert,
    label: "critical",
  },
  warning: {
    wrapper: "border-amber-500/40",
    badge: "border-amber-500/40 text-amber-400",
    icon: CircleAlert,
    label: "warning",
  },
  info: {
    wrapper: "border-border",
    badge: "border-border text-slate-400",
    icon: Info,
    label: "info",
  },
};

function AlertRow({ alert }: { alert: CashflowAlert }) {
  const style = severityStyles[alert.severity];
  const Icon = style.icon;

  return (
    <div className={cn("rounded-sm border bg-background p-4", style.wrapper)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-white">{alert.title}</p>
            <p className="mt-1 text-sm text-slate-400">{alert.detail}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono font-semibold text-white">{formatCurrency(alert.amount)}</p>
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
                ? "border-red-500/40 text-red-400"
                : "border-amber-500/40 text-amber-400"
            }
          >
            {summary.total} {summary.total === 1 ? "alert" : "alerts"}
          </Badge>
        ) : (
          <Badge className="border-emerald-500/40 text-emerald-400">
            all clear
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.length === 0 ? (
          <div className="flex items-center gap-3 rounded-sm border border-emerald-500/30 bg-background p-4 text-sm text-emerald-400">
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
