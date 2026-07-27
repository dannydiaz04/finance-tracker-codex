"use client";

import { CheckCircle2, Pencil, Sparkles, XCircle } from "lucide-react";
import { useState, useTransition } from "react";

import { RuleSuggestionCard } from "@/components/rules/rule-suggestion-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type RuleSuggestionActionResponse,
  type RuleSuggestionResolution,
  updateSuggestionReviewStatus,
} from "@/lib/categorization/rule-suggestion-state";
import type { Category, RuleSuggestion } from "@/lib/types/finance";

type RuleSuggestionPanelProps = {
  suggestions: RuleSuggestion[];
  categories: Category[];
};

type ResolutionNotice = {
  suggestionId: string;
  ruleName: string;
  resolution: RuleSuggestionResolution;
};

export function RuleSuggestionPanel({
  suggestions,
  categories,
}: RuleSuggestionPanelProps) {
  const [items, setItems] = useState(suggestions);
  const [notice, setNotice] = useState<ResolutionNotice | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isReopening, startReopening] = useTransition();
  const pending = items.filter((suggestion) => suggestion.status === "pending");
  const reviewed = items.filter(
    (suggestion) =>
      suggestion.status !== "pending" &&
      suggestion.suggestionId !== notice?.suggestionId,
  );

  const resolveSuggestion = (
    suggestion: RuleSuggestion,
    resolution: RuleSuggestionResolution,
  ) => {
    const now = new Date().toISOString();
    setItems((current) =>
      current.map((item) =>
        item.suggestionId === suggestion.suggestionId
          ? updateSuggestionReviewStatus(item, resolution.state, now)
          : item,
      ),
    );
    setNotice({
      suggestionId: suggestion.suggestionId,
      ruleName: suggestion.ruleName,
      resolution,
    });
    setActionError(null);
  };

  const accepted = notice?.resolution.state === "accepted";

  const updateSuggestion = (updated: RuleSuggestion) => {
    setItems((current) =>
      current.map((item) =>
        item.suggestionId === updated.suggestionId ? updated : item,
      ),
    );
  };

  const reopenSuggestion = (suggestion: RuleSuggestion) => {
    setActionError(null);
    startReopening(async () => {
      const response = await fetch(
        `/api/rule-suggestions/${suggestion.suggestionId}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "reopen" }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | RuleSuggestionActionResponse
        | null;

      if (!response.ok) {
        setActionError(payload?.error ?? "Unable to reopen this review.");
        return;
      }

      const now = new Date().toISOString();
      setItems((current) =>
        current.map((item) =>
          item.suggestionId === suggestion.suggestionId
            ? updateSuggestionReviewStatus(item, "pending", now)
            : item,
        ),
      );
      setNotice((current) =>
        current?.suggestionId === suggestion.suggestionId ? null : current,
      );
    });
  };

  const noticeSuggestion = notice
    ? items.find((item) => item.suggestionId === notice.suggestionId)
    : null;

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
              <div className="flex shrink-0 items-center gap-2">
                <Badge
                  className={
                    accepted
                      ? "border-emerald-500/40 text-emerald-400"
                      : "border-slate-600 text-slate-400"
                  }
                >
                  {accepted ? "Active" : "Dismissed"}
                </Badge>
                {noticeSuggestion ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="gap-1.5"
                    disabled={isReopening}
                    onClick={() => reopenSuggestion(noticeSuggestion)}
                  >
                    <Pencil className="size-3.5" />
                    Edit review
                  </Button>
                ) : null}
              </div>
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

        {reviewed.length > 0 ? (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                Recently reviewed
              </p>
              <Badge>{reviewed.length} reviewed</Badge>
            </div>
            {reviewed.map((suggestion) => {
              const subcategory = categories.find(
                (category) => category.id === suggestion.categoryId,
              );
              const wasAccepted = suggestion.status === "accepted";

              return (
                <div
                  key={suggestion.suggestionId}
                  className="rounded-sm border border-border bg-background px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-white">{suggestion.ruleName}</p>
                      <p className="mt-1 text-sm text-slate-400">
                        {suggestion.ruleDescription}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge
                        className={
                          wasAccepted
                            ? "border-emerald-500/40 text-emerald-400"
                            : "border-slate-600 text-slate-400"
                        }
                      >
                        {wasAccepted ? "Accepted" : "Dismissed"}
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="gap-1.5"
                        disabled={isReopening}
                        onClick={() => reopenSuggestion(suggestion)}
                      >
                        <Pencil className="size-3.5" />
                        Edit review
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge>
                      {subcategory
                        ? `${subcategory.group} — ${subcategory.label}`
                        : suggestion.categoryLabel}
                    </Badge>
                    <Badge>{suggestion.matchStrategy.replaceAll("_", " ")}</Badge>
                    <Badge>{suggestion.matchValue}</Badge>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {wasAccepted
                      ? "Reopen to revise this decision; the current active rule remains in effect until you accept the corrected review."
                      : "Reopen to change or accept this dismissed suggestion."}
                  </p>
                </div>
              );
            })}
          </div>
        ) : null}

        {actionError ? <p className="text-xs text-red-400">{actionError}</p> : null}
      </CardContent>
    </Card>
  );
}
