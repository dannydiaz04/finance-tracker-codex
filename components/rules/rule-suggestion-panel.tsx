"use client";

import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { useState } from "react";

import { RuleSuggestionCard } from "@/components/rules/rule-suggestion-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { RuleSuggestionResolution } from "@/lib/categorization/rule-suggestion-state";
import type { Category, RuleSuggestion } from "@/lib/types/finance";

type RuleSuggestionPanelProps = {
  suggestions: RuleSuggestion[];
  categories: Category[];
};

type ResolutionNotice = {
  ruleName: string;
  resolution: RuleSuggestionResolution;
};

export function RuleSuggestionPanel({
  suggestions,
  categories,
}: RuleSuggestionPanelProps) {
  const [pending, setPending] = useState(suggestions);
  const [notice, setNotice] = useState<ResolutionNotice | null>(null);

  const resolveSuggestion = (
    suggestion: RuleSuggestion,
    resolution: RuleSuggestionResolution,
  ) => {
    // Remove the item from the review bucket immediately. BigQuery's append-only
    // suggestion status can take a few seconds to disappear from a refreshed query.
    setPending((current) =>
      current.filter((item) => item.suggestionId !== suggestion.suggestionId),
    );
    setNotice({ ruleName: suggestion.ruleName, resolution });
  };

  const accepted = notice?.resolution.state === "accepted";

  const updateSuggestion = (updated: RuleSuggestion) => {
    setPending((current) =>
      current.map((item) =>
        item.suggestionId === updated.suggestionId ? updated : item,
      ),
    );
  };

  return (
    <Card tone="behavior">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Sparkles className="size-5 text-amber-400" />
          <div>
            <CardTitle>Needs review</CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Suggestions are inactive until you explicitly accept them.
            </p>
          </div>
        </div>
        <Badge className="border-amber-500/40 text-amber-400">
          {pending.length} pending
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice ? (
          <div
            className={
              accepted
                ? "rounded-sm border border-emerald-500/40 bg-emerald-500/[0.06] px-4 py-4 text-sm text-emerald-400"
                : "rounded-sm border border-slate-600 bg-background px-4 py-4 text-sm text-slate-300"
            }
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {accepted ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                ) : (
                  <XCircle className="mt-0.5 size-4 shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {notice.ruleName} — {notice.resolution.headline}
                  </p>
                  <p
                    className={
                      accepted ? "mt-1 text-emerald-400/80" : "mt-1 text-slate-400"
                    }
                  >
                    {notice.resolution.detail}
                  </p>
                </div>
              </div>
              <Badge
                className={
                  accepted
                    ? "border-emerald-500/40 text-emerald-400"
                    : "border-slate-600 text-slate-400"
                }
              >
                {accepted ? "Active" : "Dismissed"}
              </Badge>
            </div>
          </div>
        ) : null}

        {pending.map((suggestion) => (
          <RuleSuggestionCard
            key={suggestion.suggestionId}
            suggestion={suggestion}
            categories={categories}
            onUpdated={updateSuggestion}
            onResolved={(resolution) => resolveSuggestion(suggestion, resolution)}
          />
        ))}
        {pending.length === 0 ? (
          <p className="rounded-sm border border-emerald-500/30 bg-background px-4 py-6 text-sm text-emerald-400">
            Review queue clear — no learned rules are waiting for approval.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
