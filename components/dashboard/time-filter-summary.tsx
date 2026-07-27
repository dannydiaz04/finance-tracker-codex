import { CalendarRange } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatTimeFilterLabel, type TimeFilter } from "@/lib/time-filter";

type TimeFilterSummaryProps = {
  filter: TimeFilter;
  fields: string;
};

export function TimeFilterSummary({ filter, fields }: TimeFilterSummaryProps) {
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-border bg-card px-4 py-3 text-sm text-slate-300 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <CalendarRange className="mt-0.5 size-4 shrink-0 text-emerald-500" />
        <div>
          <p className="font-medium text-white">
            Time scope: {formatTimeFilterLabel(filter)}
          </p>
          <p className="mt-1 text-slate-400">{fields}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge className="w-fit">URL params: from / to</Badge>
        {filter.excludePlaid ? (
          <Badge className="w-fit border-amber-500/40 text-amber-400">
            CSV only (Plaid hidden)
          </Badge>
        ) : null}
      </div>
    </div>
  );
}
