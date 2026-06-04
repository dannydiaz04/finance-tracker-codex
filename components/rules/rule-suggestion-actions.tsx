"use client";

import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

type RuleSuggestionActionsProps = {
  suggestionId: string;
};

export function RuleSuggestionActions({
  suggestionId,
}: RuleSuggestionActionsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submitAction = (action: "accept" | "dismiss") => {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/rule-suggestions/${suggestionId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Unable to update suggestion.");
        return;
      }

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
      {error ? <p className="basis-full text-xs text-rose-200">{error}</p> : null}
    </div>
  );
}
