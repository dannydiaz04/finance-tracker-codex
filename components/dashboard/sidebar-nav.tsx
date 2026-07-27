"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowRightLeft,
  Banknote,
  CandlestickChart,
  ChartColumnBig,
  Landmark,
  Layers3,
  ReceiptText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  TIME_FILTER_CHANGE_EVENT,
  copyTimeFilterParams,
} from "@/lib/time-filter";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/overview", label: "Overview", icon: ChartColumnBig },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/cashflow", label: "Cash Flow", icon: ArrowRightLeft },
  { href: "/categories", label: "Categories", icon: Layers3 },
  { href: "/merchants", label: "Merchants", icon: Banknote },
  { href: "/rules", label: "Rules & Review", icon: ShieldCheck },
  { href: "/connections" as Route, label: "Connections", icon: Landmark },
  { href: "/assistant" as Route, label: "Assistant", icon: Sparkles },
] as const satisfies ReadonlyArray<{
  href: Route;
  label: string;
  icon: typeof ChartColumnBig;
}>;

export function SidebarNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [timeQueryString, setTimeQueryString] = useState(() =>
    copyTimeFilterParams(searchParams).toString(),
  );

  useEffect(() => {
    const syncTimeQueryString = (event?: Event) => {
      const queryString =
        event instanceof CustomEvent && typeof event.detail === "string"
          ? event.detail
          : window.location.search.slice(1);

      setTimeQueryString(
        copyTimeFilterParams(new URLSearchParams(queryString)).toString(),
      );
    };

    window.addEventListener(TIME_FILTER_CHANGE_EVENT, syncTimeQueryString);
    window.addEventListener("popstate", syncTimeQueryString);

    return () => {
      window.removeEventListener(TIME_FILTER_CHANGE_EVENT, syncTimeQueryString);
      window.removeEventListener("popstate", syncTimeQueryString);
    };
  }, []);

  return (
    <aside className="sticky top-0 z-30 hidden h-screen w-60 shrink-0 border-r border-border bg-background px-4 py-5 xl:flex xl:flex-col">
      <div className="mb-8 flex items-center gap-2.5 px-2">
        <CandlestickChart className="size-5 text-emerald-500" />
        <div>
          <h1 className="font-mono text-sm font-semibold uppercase tracking-widest text-white">
            Finance Tracker
          </h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-slate-600">
            Personal ledger
          </p>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={
                `${item.href}${timeQueryString ? `?${timeQueryString}` : ""}` as Route
              }
              className={cn(
                "group flex items-center gap-3 border-l-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-emerald-500 bg-white/[0.04] text-white"
                  : "border-transparent text-slate-500 hover:bg-white/[0.03] hover:text-slate-200",
              )}
            >
              <Icon
                className={cn(
                  "size-4",
                  active ? "text-emerald-500" : "text-slate-600 group-hover:text-slate-400",
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border px-2 pt-4">
        <Badge>Single-user MVP</Badge>
      </div>
    </aside>
  );
}
