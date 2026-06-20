"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type AiFallbackCardProps = {
  initialCount: number;
  threshold: number;
  openAiConfigured: boolean;
  bigQueryConfigured: boolean;
  source: "warehouse" | "sample";
};

type EnrichResponse = {
  result?:
    | { status: "ran"; summary?: EnrichSummary }
    | { status: "skipped"; reason?: string }
    | { status: "error"; reason?: string };
  summary?: { count?: number } | null;
  error?: string;
};

type EnrichSummary = {
  enrichedCount: number;
  acceptedCount: number;
  needsReviewCount: number;
  rejectedCount: number;
};

export function AiFallbackCard({
  initialCount,
  threshold,
  openAiConfigured,
  bigQueryConfigured,
  source,
}: AiFallbackCardProps) {
  const router = useRouter();
  const [count, setCount] = useState(initialCount);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/enrich/low-confidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as EnrichResponse;

      if (!response.ok) {
        setMessage(data.error ?? "AI fallback failed.");
        return;
      }

      if (typeof data.summary?.count === "number") {
        setCount(data.summary.count);
      }

      const result = data.result;

      if (result?.status === "ran" && result.summary) {
        setMessage(
          `Enriched ${result.summary.enrichedCount}: ${result.summary.acceptedCount} accepted, ${result.summary.needsReviewCount} need review.`,
        );
      } else if (result?.status === "skipped") {
        setMessage(result.reason ?? "AI fallback skipped.");
      } else if (result?.status === "error") {
        setMessage(result.reason ?? "AI fallback failed.");
      } else {
        setMessage("AI fallback finished.");
      }

      router.refresh();
    } catch {
      setMessage("Network error while running AI fallback.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  const thresholdLabel = `${Math.round(threshold * 100)}%`;
  const canRun = openAiConfigured && bigQueryConfigured && !loading;

  return (
    <Card tone="review">
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-cyan-300" />
            AI fallback
          </CardTitle>
          <CardDescription>
            Classify rows below {thresholdLabel} confidence with the model.
          </CardDescription>
        </div>
        {source === "sample" ? (
          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-100">
            sample
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-3xl font-semibold text-white">{count}</p>
          <p className="mt-1 text-sm text-slate-400">
            low-confidence {count === 1 ? "row" : "rows"} awaiting AI fallback
          </p>
        </div>

        <Button onClick={run} disabled={!canRun} size="sm">
          {loading ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 size-4" />
          )}
          Run AI fallback
        </Button>

        {!openAiConfigured ? (
          <p className="text-xs text-amber-200/80">
            Set OPENAI_API_KEY to enable AI fallback.
          </p>
        ) : !bigQueryConfigured ? (
          <p className="text-xs text-amber-200/80">
            Connect BigQuery to persist AI suggestions.
          </p>
        ) : null}

        {message ? <p className="text-xs text-slate-400">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
