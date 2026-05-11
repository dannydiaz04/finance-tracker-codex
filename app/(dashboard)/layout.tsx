import type { ReactNode } from "react";
import { Suspense } from "react";

import { MobileNav } from "@/components/dashboard/mobile-nav";
import { SidebarNav } from "@/components/dashboard/sidebar-nav";
import { TimeRangeFilter } from "@/components/dashboard/time-range-filter";

export default function DashboardLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#11203d,transparent_28%),linear-gradient(180deg,#030712,#020617_45%,#02050d)]">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <Suspense fallback={null}>
          <SidebarNav />
        </Suspense>
        <div className="flex min-h-screen flex-1 flex-col">
          <Suspense fallback={null}>
            <MobileNav />
          </Suspense>
          <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
        </div>
      </div>
      <Suspense fallback={null}>
        <TimeRangeFilter />
      </Suspense>
    </div>
  );
}
