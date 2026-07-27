"use client";

import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  type RuleSuggestionAction,
  type RuleSuggestionActionResponse,
  type RuleSuggestionResolution,
  describeSuggestionResolution,
} from "@/lib/categorization/rule-suggestion-state";

type RuleSuggestionActionsProps = {
  suggestionId: string;
  onResolved?: (resolution: RuleSuggestionResolution) => void;
};

export function RuleSuggestionActions({
  suggestionId,
  onResolved,
}: RuleSuggestionActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submitAction = (action: RuleSuggestionAction) => {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/rule-suggestions/${suggestionId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });

      const payload = (await response.json().catch(() => null)) as
        | RuleSuggestionActionResponse
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to update suggestion.");
        return;
      }

      onResolved?.(describeSuggestionResolution({ action, payload }));
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="gap-1.5"
        disabled={isPending}
        onClick={() => submitAction("accept")}
      >
        <Check className="size-4" />
        Accept
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="gap-1.5"
        disabled={isPending}
        onClick={() => submitAction("dismiss")}
      >
        <X className="size-4" />
        Dismiss
      </Button>
      {error ? <p className="basis-full text-xs text-red-400">{error}</p> : null}
    </div>
  );
}
