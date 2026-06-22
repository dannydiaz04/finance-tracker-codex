"use client";

import type { Route } from "next";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, RotateCcw, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TIME_FILTER_CHANGE_EVENT,
  TIME_FILTER_QUERY_KEYS,
  formatTimeFilterLabel,
  normalizeTimeFilter,
  type TimeFilter,
  type TimeFilterPreset,
} from "@/lib/time-filter";
import { cn } from "@/lib/utils";

type PresetOption = {
  label: string;
  value: TimeFilterPreset;
};

const presetOptions: PresetOption[] = [
  { label: "All", value: "all" },
  { label: "30D", value: "last30" },
  { label: "90D", value: "last90" },
  { label: "YTD", value: "ytd" },
];

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getPresetRange(preset: TimeFilterPreset): TimeFilter {
  const today = new Date();

  if (preset === "all") {
    return { preset: "all" };
  }

  if (preset === "ytd") {
    return {
      preset,
      from: `${today.getFullYear()}-01-01`,
      to: toDateInputValue(today),
    };
  }

  const days = preset === "last30" ? 30 : 90;
  const from = new Date(today);
  from.setDate(today.getDate() - days + 1);

  return {
    preset,
    from: toDateInputValue(from),
    to: toDateInputValue(today),
  };
}

function announceFilterChange(queryString: string) {
  window.dispatchEvent(
    new CustomEvent(TIME_FILTER_CHANGE_EVENT, { detail: queryString }),
  );
}

export function TimeRangeFilter() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const currentFilter = useMemo(
    () => normalizeTimeFilter(Object.fromEntries(searchParams.entries())),
    [searchParams],
  );
  const currentRangeKey = `${currentFilter.from ?? ""}|${currentFilter.to ?? ""}`;
  const [draftRange, setDraftRange] = useState({
    from: "",
    to: "",
    source: "",
  });
  const customRange =
    draftRange.source === currentRangeKey
      ? draftRange
      : {
          from: currentFilter.from ?? "",
          to: currentFilter.to ?? "",
          source: currentRangeKey,
        };

  const pushFilter = (filter: TimeFilter) => {
    const params = new URLSearchParams(searchParams.toString());

    TIME_FILTER_QUERY_KEYS.forEach((key) => params.delete(key));

    if (filter.from) {
      params.set("from", filter.from);
    }

    if (filter.to) {
      params.set("to", filter.to);
    }

    if (filter.preset !== "all") {
      params.set("timePreset", filter.preset);
    }

    const queryString = params.toString();
    router.push(`${pathname}${queryString ? `?${queryString}` : ""}` as Route);
    announceFilterChange(queryString);
    setOpen(false);
  };

  const resetFilter = () => {
    const params = new URLSearchParams(searchParams.toString());
    TIME_FILTER_QUERY_KEYS.forEach((key) => params.delete(key));
    const queryString = params.toString();

    setDraftRange({ from: "", to: "", source: "" });
    router.push(`${pathname}${queryString ? `?${queryString}` : ""}` as Route);
    announceFilterChange(queryString);
    setOpen(false);
  };

  return (
    <>
      <Button
        type="button"
        className="fixed bottom-5 right-5 z-40 gap-2 shadow-[0_18px_70px_rgba(34,211,238,0.28)] md:bottom-auto md:top-5"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="size-4" />
        Time filters
      </Button>

      <div
        className={cn(
          "fixed inset-0 z-50 overflow-hidden transition-all",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <button
          type="button"
          aria-label="Close time filters"
          className={cn(
            "absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity",
            open ? "opacity-100" : "opacity-0",
          )}
          onClick={() => setOpen(false)}
        />

        <aside
          className={cn(
            "absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-white/10 bg-slate-950 shadow-[-24px_0_80px_rgba(2,6,23,0.55)] transition-transform duration-300",
            open ? "translate-x-0" : "translate-x-full",
          )}
          aria-label="Time filter parameters"
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-5">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-2.5 text-cyan-200">
                <CalendarRange className="size-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Time parameters</p>
                <p className="mt-1 text-sm text-slate-400">
                  {formatTimeFilterLabel(currentFilter)}
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Close time filters"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-5">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-500">
                  Filter fields
                </p>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  URL params `from` and `to` filter transaction `posted_at` (UI
                  field `postedAt`). Cash-flow panels use `daily_cashflow.date`,
                  bucketed from posted transactions. Current balance cards remain
                  account snapshots.
                </p>
              </div>

              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">
                  Presets
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {presetOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={cn(
                        "h-10 rounded-xl border border-white/10 px-3 text-xs font-medium text-slate-400 transition-colors",
                        currentFilter.preset === option.value
                          ? "border-cyan-300/30 bg-cyan-400/15 text-cyan-100"
                          : "bg-white/[0.03] hover:bg-white/[0.06] hover:text-white",
                      )}
                      onClick={() => {
                        const nextFilter = getPresetRange(option.value);
                        setDraftRange({
                          from: nextFilter.from ?? "",
                          to: nextFilter.to ?? "",
                          source: `${nextFilter.from ?? ""}|${nextFilter.to ?? ""}`,
                        });
                        pushFilter(nextFilter);
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid gap-3">
                <label className="grid gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                  Posted from
                  <Input
                    type="date"
                    value={customRange.from}
                    onChange={(event) =>
                      setDraftRange((current) => ({
                        ...current,
                        source: currentRangeKey,
                        from: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="grid gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                  Posted to
                  <Input
                    type="date"
                    value={customRange.to}
                    onChange={(event) =>
                      setDraftRange((current) => ({
                        ...current,
                        source: currentRangeKey,
                        to: event.target.value,
                      }))
                    }
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3 border-t border-white/10 px-5 py-4">
            <Button
              type="button"
              onClick={() =>
                pushFilter({
                  preset: "custom",
                  from: customRange.from || undefined,
                  to: customRange.to || undefined,
                })
              }
            >
              Apply parameters
            </Button>
            <Button
              type="button"
              variant="secondary"
              aria-label="Reset time filter"
              onClick={resetFilter}
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
        </aside>
      </div>
    </>
  );
}
