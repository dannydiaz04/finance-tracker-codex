"use client";

import type { Route } from "next";
import { CalendarDays } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select } from "@/components/ui/select";
import {
  TIME_FILTER_CHANGE_EVENT,
  TIME_FILTER_QUERY_KEYS,
} from "@/lib/time-filter";
import type { MonthlyFinanceSummary } from "@/lib/types/finance";
import { formatCurrency } from "@/lib/utils";

type MonthSelectorProps = {
  months: MonthlyFinanceSummary[];
  selectedMonth: string | null;
};

export function MonthSelector({ months, selectedMonth }: MonthSelectorProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedSummary =
    months.find((summary) => summary.month === selectedMonth) ?? null;

  const selectMonth = (month: string) => {
    const params = new URLSearchParams(searchParams.toString());

    TIME_FILTER_QUERY_KEYS.forEach((key) => params.delete(key));

    if (month) {
      params.set("month", month);
    }

    const queryString = params.toString();

    router.push(`${pathname}${queryString ? `?${queryString}` : ""}` as Route);
    window.dispatchEvent(
      new CustomEvent(TIME_FILTER_CHANGE_EVENT, { detail: queryString }),
    );
  };

  return (
    <div className="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-4 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2.5 text-cyan-200">
          <CalendarDays className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-white">Month</p>
          <p className="mt-1 text-sm text-slate-400">
            {selectedSummary
              ? `${selectedSummary.from} to ${selectedSummary.to}`
              : "Custom date range"}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:min-w-80">
        <Select
          aria-label="Select month"
          value={selectedMonth ?? ""}
          onChange={(event) => selectMonth(event.target.value)}
          disabled={months.length === 0}
        >
          {selectedMonth ? null : <option value="">Custom date range</option>}
          {months.map((summary) => (
            <option key={summary.month} value={summary.month}>
              {summary.label} - In {formatCurrency(summary.income, "USD", 0)} -
              Out {formatCurrency(summary.spend, "USD", 0)}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
