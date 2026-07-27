"use client";

import { useState } from "react";

import { RuleSuggestionActions } from "@/components/rules/rule-suggestion-actions";
import { Badge } from "@/components/ui/badge";
import type { RuleSuggestionResolution } from "@/lib/categorization/rule-suggestion-state";
import type { RuleSuggestion } from "@/lib/types/finance";

type RuleSuggestionCardProps = {
  suggestion: RuleSuggestion;
};

export function RuleSuggestionCard({ suggestion }: RuleSuggestionCardProps) {
  const [resolution, setResolution] = useState<RuleSuggestionResolution | null>(null);

  // The accepted/dismissed row lands in an append-only table that the pending-suggestion
  // query may not see for a few seconds, so the card keeps its own resolved state instead
  // of waiting for the refreshed server render to drop it.
  if (resolution) {
    return (
      <div className="rounded-sm border border-emerald-500/30 bg-background px-4 py-4 text-sm text-emerald-400">
        <p className="font-medium">
          {suggestion.ruleName} — {resolution.headline}
        </p>
        <p className="mt-1 text-emerald-400/80">{resolution.detail}</p>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-border bg-background px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-white">{suggestion.ruleName}</p>
          <p className="mt-1 text-sm text-slate-400">{suggestion.ruleDescription}</p>
        </div>
        <Badge>{suggestion.categoryLabel}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge>{suggestion.matchStrategy.replace("_", " ")}</Badge>
        <Badge>{suggestion.matchValue}</Badge>
      </div>
      <div className="mt-4">
        <RuleSuggestionActions
          suggestionId={suggestion.suggestionId}
          onResolved={setResolution}
        />
      </div>
    </div>
  );
}
