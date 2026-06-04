import type { CategorySparklinePoint } from "@/lib/types/finance";

export type SparklineColors = {
  stroke: string;
  fillFrom: string;
};

type CategorySparklineProps = {
  points: CategorySparklinePoint[];
  colors: SparklineColors;
  uniqueId: string;
  className?: string;
  height?: number;
};

export function CategorySparkline({
  points,
  colors,
  uniqueId,
  className,
  height = 32,
}: CategorySparklineProps) {
  const width = 100;
  const padding = 2;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  if (points.length === 0) {
    return (
      <div
        className={
          className ??
          "flex h-8 items-center text-[10px] uppercase tracking-[0.2em] text-slate-600"
        }
      >
        no daily activity
      </div>
    );
  }

  const max = Math.max(...points.map((point) => point.amount), 1);

  const xFor = (index: number) => {
    if (points.length === 1) {
      return width / 2;
    }
    return padding + (index / (points.length - 1)) * usableWidth;
  };
  const yFor = (amount: number) =>
    padding + usableHeight - (amount / max) * usableHeight;

  const linePoints = points
    .map((point, index) => `${xFor(index)},${yFor(point.amount)}`)
    .join(" ");

  const areaPath =
    points.length === 1
      ? `M ${padding},${height - padding} L ${width / 2},${yFor(points[0].amount)} L ${width - padding},${height - padding} Z`
      : `M ${xFor(0)},${height - padding} ${points
          .map((point, index) => `L ${xFor(index)},${yFor(point.amount)}`)
          .join(" ")} L ${xFor(points.length - 1)},${height - padding} Z`;

  const lastIndex = points.length - 1;
  const lastX = xFor(lastIndex);
  const lastY = yFor(points[lastIndex].amount);

  const gradientId = `spark-${uniqueId}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className ?? "h-9 w-full"}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colors.fillFrom} stopOpacity="0.55" />
          <stop offset="100%" stopColor={colors.fillFrom} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      {points.length > 1 ? (
        <polyline
          points={linePoints}
          fill="none"
          stroke={colors.stroke}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : null}
      <circle cx={lastX} cy={lastY} r="2" fill={colors.stroke} />
      <circle
        cx={lastX}
        cy={lastY}
        r="4"
        fill={colors.stroke}
        fillOpacity="0.25"
      />
    </svg>
  );
}
