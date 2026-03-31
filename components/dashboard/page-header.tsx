import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="max-w-2xl space-y-3">
        <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
          {eyebrow}
        </Badge>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-white md:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm leading-7 text-slate-400 md:text-base">
            {description}
          </p>
        </div>
      </div>

      {action ? <div>{action}</div> : null}
    </div>
  );
}
