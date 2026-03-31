"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRightLeft,
  Banknote,
  CandlestickChart,
  ChartColumnBig,
  Layers3,
  ReceiptText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/overview", label: "Overview", icon: ChartColumnBig },
  { href: "/transactions", label: "Transactions", icon: ReceiptText },
  { href: "/cashflow", label: "Cash Flow", icon: ArrowRightLeft },
  { href: "/categories", label: "Categories", icon: Layers3 },
  { href: "/merchants", label: "Merchants", icon: Banknote },
  { href: "/rules", label: "Rules & Review", icon: ShieldCheck },
  { href: "/assistant" as Route, label: "Assistant", icon: Sparkles },
] as const satisfies ReadonlyArray<{
  href: Route;
  label: string;
  icon: typeof ChartColumnBig;
}>;

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-72 shrink-0 border-r border-white/10 bg-slate-950/70 px-5 py-6 backdrop-blur xl:flex xl:flex-col">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.32em] text-cyan-300/80">
            Finance Tracker
          </p>
          <h1 className="mt-2 text-xl font-semibold text-white">Warehouse OS</h1>
        </div>
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-200">
          <CandlestickChart className="size-5" />
        </div>
      </div>

      <div className="mb-8 rounded-3xl border border-white/10 bg-white/[0.04] p-4">
        <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
          Single-user MVP
        </Badge>
        <p className="mt-4 text-sm leading-6 text-slate-300">
          CSV-first ingestion with a Plaid-ready event model, deterministic rules,
          and a review-first explorer.
        </p>
      </div>

      <nav className="flex flex-col gap-2">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex items-center gap-3 rounded-2xl px-4 py-3 text-sm transition-colors",
                active
                  ? "bg-cyan-400/10 text-white ring-1 ring-cyan-300/20"
                  : "text-slate-400 hover:bg-white/[0.04] hover:text-white",
              )}
            >
              <Icon
                className={cn(
                  "size-4 transition-transform",
                  active ? "text-cyan-300" : "text-slate-500 group-hover:text-cyan-300",
                )}
              />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_top,#1c2840,transparent_60%)] p-4">
        <p className="text-xs uppercase tracking-[0.28em] text-slate-500">
          Next phase
        </p>
        <p className="mt-2 text-sm text-slate-300">
          Plaid sync, AI fallback for low-confidence rows, and alerting for abnormal
          cash flow.
        </p>
      </div>
    </aside>
  );
}
