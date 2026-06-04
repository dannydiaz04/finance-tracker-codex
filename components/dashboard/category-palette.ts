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

const trendTokens = {
  trendPositive: "text-rose-200 bg-rose-500/15 border-rose-400/30",
  trendNegative: "text-emerald-200 bg-emerald-500/15 border-emerald-400/30",
  trendNeutral: "text-slate-300 bg-white/5 border-white/10",
};

const palettes: CategoryPalette[] = [
  {
    from: "#22d3ee",
    to: "#3b82f6",
    ring: "ring-cyan-300/30",
    bar: "bg-gradient-to-r from-cyan-400 to-blue-500",
    glow: "shadow-[0_0_24px_rgba(34,211,238,0.18)]",
    ...trendTokens,
  },
  {
    from: "#a855f7",
    to: "#ec4899",
    ring: "ring-fuchsia-300/30",
    bar: "bg-gradient-to-r from-fuchsia-400 to-pink-500",
    glow: "shadow-[0_0_24px_rgba(217,70,239,0.18)]",
    ...trendTokens,
  },
  {
    from: "#34d399",
    to: "#0ea5e9",
    ring: "ring-emerald-300/30",
    bar: "bg-gradient-to-r from-emerald-400 to-sky-500",
    glow: "shadow-[0_0_24px_rgba(16,185,129,0.18)]",
    ...trendTokens,
  },
  {
    from: "#f59e0b",
    to: "#ef4444",
    ring: "ring-amber-300/30",
    bar: "bg-gradient-to-r from-amber-400 to-rose-500",
    glow: "shadow-[0_0_24px_rgba(245,158,11,0.18)]",
    ...trendTokens,
  },
  {
    from: "#818cf8",
    to: "#22d3ee",
    ring: "ring-indigo-300/30",
    bar: "bg-gradient-to-r from-indigo-400 to-cyan-400",
    glow: "shadow-[0_0_24px_rgba(129,140,248,0.18)]",
    ...trendTokens,
  },
  {
    from: "#fb7185",
    to: "#a855f7",
    ring: "ring-rose-300/30",
    bar: "bg-gradient-to-r from-rose-400 to-purple-500",
    glow: "shadow-[0_0_24px_rgba(251,113,133,0.18)]",
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
