"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import {
  TIME_FILTER_CHANGE_EVENT,
  copyTimeFilterParams,
} from "@/lib/time-filter";
import { cn } from "@/lib/utils";

const items = [
  { href: "/overview", label: "Overview" },
  { href: "/transactions", label: "Transactions" },
  { href: "/cashflow", label: "Cash Flow" },
  { href: "/categories", label: "Categories" },
  { href: "/merchants", label: "Merchants" },
  { href: "/rules", label: "Rules" },
  { href: "/assistant" as Route, label: "Assistant" },
] as const satisfies ReadonlyArray<{ href: Route; label: string }>;

export function MobileNav() {
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
    <nav className="sticky top-0 z-40 overflow-x-auto border-b border-white/10 bg-slate-950/80 backdrop-blur xl:hidden">
      <div className="flex min-w-max gap-2 px-4 py-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={
              `${item.href}${timeQueryString ? `?${timeQueryString}` : ""}` as Route
            }
            className={cn(
              "rounded-full px-3 py-2 text-sm transition-colors",
              pathname === item.href
                ? "bg-cyan-400/10 text-cyan-100 ring-1 ring-cyan-300/20"
                : "text-slate-400 hover:bg-white/[0.04] hover:text-white",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
