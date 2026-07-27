export type CategoryPalette = {
  from: string;
  to: string;
  ring: string;
  bar: string;
  glow: string;
  trendPositive: string;
  trendNegative: string;
  trendNeutral: string;
};

/* Spend up = bad (red), spend down = good (green): classic market semantics. */
const trendTokens = {
  trendPositive: "text-red-400 bg-red-500/10 border-red-500/30",
  trendNegative: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  trendNeutral: "text-slate-400 bg-white/5 border-border",
};

/* Restrained monochrome-plus-green ramp instead of neon gradients. */
const palettes: CategoryPalette[] = [
  {
    from: "#22c55e",
    to: "#16a34a",
    ring: "ring-emerald-500/30",
    bar: "bg-emerald-500",
    glow: "",
    ...trendTokens,
  },
  {
    from: "#64748b",
    to: "#475569",
    ring: "ring-slate-500/30",
    bar: "bg-slate-500",
    glow: "",
    ...trendTokens,
  },
  {
    from: "#10b981",
    to: "#059669",
    ring: "ring-emerald-500/30",
    bar: "bg-emerald-600",
    glow: "",
    ...trendTokens,
  },
  {
    from: "#94a3b8",
    to: "#64748b",
    ring: "ring-slate-400/30",
    bar: "bg-slate-400",
    glow: "",
    ...trendTokens,
  },
  {
    from: "#34d399",
    to: "#10b981",
    ring: "ring-emerald-400/30",
    bar: "bg-emerald-400",
    glow: "",
    ...trendTokens,
  },
  {
    from: "#475569",
    to: "#334155",
    ring: "ring-slate-600/30",
    bar: "bg-slate-600",
    glow: "",
    ...trendTokens,
  },
];

export function paletteFor(categoryId: string): CategoryPalette {
  let hash = 0;
  for (let index = 0; index < categoryId.length; index += 1) {
    hash = (hash * 31 + categoryId.charCodeAt(index)) | 0;
  }
  return palettes[Math.abs(hash) % palettes.length];
}
