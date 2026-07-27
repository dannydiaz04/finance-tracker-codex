import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import type { CategoryPalette } from "@/components/dashboard/category-palette";
import { cn, formatPercent } from "@/lib/utils";

type TrendPillProps = {
  trend: number;
  palette: CategoryPalette;
  className?: string;
};

export function TrendPill({ trend, palette, className }: TrendPillProps) {
  const rounded = Math.abs(trend) < 0.005 ? 0 : trend;
  const Icon = rounded > 0 ? ArrowUpRight : rounded < 0 ? ArrowDownRight : Minus;
  const tone =
    rounded > 0
      ? palette.trendPositive
      : rounded < 0
        ? palette.trendNegative
        : palette.trendNeutral;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[11px] font-medium",
        tone,
        className,
      )}
    >
      <Icon className="size-3" />
      {rounded === 0 ? "flat" : formatPercent(rounded)}
    </span>
  );
}
