import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Badge({
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center break-words rounded-sm border border-border bg-transparent px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-slate-400",
        className,
      )}
      {...props}
    />
  );
}
