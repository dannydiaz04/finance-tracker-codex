import { CalendarRange } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatTimeFilterLabel, type TimeFilter } from "@/lib/time-filter";

type TimeFilterSummaryProps = {
  filter: TimeFilter;
  fields: string;
};

export function TimeFilterSummary({ filter, fields }: TimeFilterSummaryProps) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300 md:flex-row md:items-center md:justify-between">
      <div className="flex items-start gap-3">
        <CalendarRange className="mt-0.5 size-4 shrink-0 text-cyan-300" />
        <div>
          <p className="font-medium text-white">
            Time scope: {formatTimeFilterLabel(filter)}
          </p>
          <p className="mt-1 text-slate-400">{fields}</p>
        </div>
      </div>
      <Badge className="w-fit">URL params: from / to</Badge>
    </div>
  );
}
