import * as React from "react";

import { cn } from "@/lib/utils";

const Select = React.forwardRef<HTMLSelectElement, React.ComponentProps<"select">>(
  ({ className, children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={cn(
          "flex h-9 w-full appearance-none rounded-sm border border-border bg-background bg-[length:12px_12px] bg-no-repeat py-2 pl-3 pr-10 text-sm text-slate-100 outline-none transition-colors focus:border-emerald-500/60",
          "bg-[image:url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='%2394a3b8' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3e%3cpath d='M6 8l4 4 4-4'/%3e%3c/svg%3e\")] bg-[position:right_0.875rem_center]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

Select.displayName = "Select";

export { Select };
