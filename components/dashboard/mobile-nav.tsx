"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <nav className="overflow-x-auto border-b border-white/10 xl:hidden">
      <div className="flex min-w-max gap-2 px-4 py-3">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
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
