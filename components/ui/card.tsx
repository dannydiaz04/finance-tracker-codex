import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export type CardTone =
  | "neutral"
  | "balance"
  | "income"
  | "spend"
  | "flow"
  | "behavior"
  | "category"
  | "merchant"
  | "review";

/* Flat ticker-style accent rule per tone; kept minimal on purpose. */
const cardToneBars: Record<CardTone, string> = {
  neutral: "",
  balance: "bg-emerald-500",
  income: "bg-emerald-500",
  spend: "bg-red-500",
  flow: "bg-slate-500",
  behavior: "bg-amber-500",
  category: "bg-slate-500",
  merchant: "bg-slate-500",
  review: "bg-red-500",
};

type CardProps = HTMLAttributes<HTMLDivElement> & {
  tone?: CardTone;
};

export function Card({
  className,
  tone = "neutral",
  children,
  ...props
}: CardProps) {
  const bar = cardToneBars[tone];

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-sm border border-border bg-card",
        className,
      )}
      {...props}
    >
      {bar ? (
        <span
          aria-hidden
          className={cn("pointer-events-none absolute inset-y-0 left-0 w-0.5", bar)}
        />
      ) : null}
      {children}
    </div>
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 flex-col gap-1.5 p-5", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "break-words text-sm font-semibold uppercase tracking-wider text-slate-200",
        className,
      )}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs text-slate-500", className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 px-5 pb-5", className)} {...props} />;
}
