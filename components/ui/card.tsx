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

type CardToneStyle = {
  border: string;
  glow: string;
  bar: string;
};

const cardTones: Record<CardTone, CardToneStyle> = {
  neutral: {
    border: "border-white/10",
    glow: "shadow-[0_30px_80px_rgba(3,7,18,0.55)]",
    bar: "",
  },
  balance: {
    border: "border-cyan-400/30",
    glow: "shadow-[0_28px_70px_rgba(34,211,238,0.18)]",
    bar: "from-cyan-400 via-cyan-300 to-sky-500",
  },
  income: {
    border: "border-emerald-400/30",
    glow: "shadow-[0_28px_70px_rgba(16,185,129,0.2)]",
    bar: "from-emerald-400 via-emerald-300 to-teal-500",
  },
  spend: {
    border: "border-fuchsia-400/30",
    glow: "shadow-[0_28px_70px_rgba(232,121,249,0.2)]",
    bar: "from-fuchsia-400 via-rose-400 to-pink-500",
  },
  flow: {
    border: "border-sky-400/30",
    glow: "shadow-[0_28px_70px_rgba(56,189,248,0.18)]",
    bar: "from-sky-400 via-blue-400 to-indigo-500",
  },
  behavior: {
    border: "border-amber-400/30",
    glow: "shadow-[0_28px_70px_rgba(251,191,36,0.16)]",
    bar: "from-amber-300 via-orange-400 to-amber-500",
  },
  category: {
    border: "border-violet-400/30",
    glow: "shadow-[0_28px_70px_rgba(167,139,250,0.2)]",
    bar: "from-violet-400 via-purple-400 to-indigo-500",
  },
  merchant: {
    border: "border-indigo-400/30",
    glow: "shadow-[0_28px_70px_rgba(129,140,248,0.18)]",
    bar: "from-indigo-400 via-blue-400 to-sky-500",
  },
  review: {
    border: "border-rose-400/30",
    glow: "shadow-[0_28px_70px_rgba(251,113,133,0.18)]",
    bar: "from-rose-400 via-orange-400 to-amber-400",
  },
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
  const toneStyle = cardTones[tone];
  const isToned = tone !== "neutral";

  return (
    <div
      className={cn(
        "rounded-3xl border bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(8,15,30,0.9))] backdrop-blur",
        isToned && "relative overflow-hidden",
        toneStyle.border,
        toneStyle.glow,
        className,
      )}
      {...props}
    >
      {isToned ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r",
            toneStyle.bar,
          )}
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
  return <div className={cn("flex min-w-0 flex-col gap-2 p-6", className)} {...props} />;
}

export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("break-words text-lg font-semibold tracking-tight text-white", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-slate-400", className)} {...props} />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 px-6 pb-6", className)} {...props} />;
}
