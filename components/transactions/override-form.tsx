"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  type RuleAction,
  type SaveResultTone,
  describePreview,
  describeSaveResult,
  resolveDefaultCategoryId,
} from "@/lib/categorization/override-form-state";
import type { Category } from "@/lib/types/finance";

type OverrideFormProps = {
  transactionId: string;
  /** Current derived category id — used as the default and the no-op guard. */
  currentCategoryId: string | null;
  /** AI/derived label shown read-only for context. Never pre-selected (anti-rubber-stamp). */
  suggestedCategoryLabel?: string | null;
  categories: Category[];
  variant?: "drawer" | "inline";
  onResolved?: (result: { persisted: boolean }) => void;
};

const toneClass: Record<SaveResultTone, string> = {
  success: "text-sm text-emerald-200",
  partial: "text-sm text-amber-200",
  local: "text-sm text-slate-300",
  error: "text-sm text-rose-200",
};

export function OverrideForm({
  transactionId,
  currentCategoryId,
  suggestedCategoryLabel,
  categories,
  variant = "drawer",
  onResolved,
}: OverrideFormProps) {
  const [categoryId, setCategoryId] = useState(() =>
    resolveDefaultCategoryId(currentCategoryId, categories),
  );
  const [note, setNote] = useState("");
  const [action, setAction] = useState<RuleAction>("suggest");
  const [preview, setPreview] = useState<{ key: string; text: string | null } | null>(null);
  const [result, setResult] = useState<{ tone: SaveResultTone; message: string } | null>(null);
  const [isSaving, startTransition] = useTransition();

  const inline = variant === "inline";
  // Only a real correction can teach a rule (confirming the current category is a no-op).
  const willLearn = categoryId !== "" && categoryId !== currentCategoryId && action !== "none";

  // Debounced server dry-run: faithful match preview + blast-radius count, no client-side
  // normalization. Skipped unless the change would actually create/suggest a rule. The
  // result is keyed to (category, action) so a stale preview is never rendered.
  useEffect(() => {
    if (!willLearn) {
      return;
    }
    const controller = new AbortController();
    const key = `${categoryId}|${action}`;
    const timer = setTimeout(() => {
      void fetch("/api/categories/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transactionId, categoryId, ruleAction: action, dryRun: true }),
        signal: controller.signal,
      })
        .then(async (response) => (response.ok ? describePreview(await response.json()) : null))
        .then((text) => setPreview({ key, text }))
        .catch(() => {
          /* aborted / offline — leave the previous preview */
        });
    }, 400);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [transactionId, categoryId, action, willLearn]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!categoryId) {
      setResult({ tone: "error", message: "Choose a category first." });
      return;
    }
    setResult(null);
    startTransition(async () => {
      const response = await fetch("/api/categories/override", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transactionId,
          categoryId,
          note: note.trim() || undefined,
          ruleAction: action,
        }),
      });
      const payload = await response.json().catch(() => null);
      setResult(describeSaveResult({ ok: response.ok, payload }));
      if (response.ok) {
        onResolved?.({ persisted: Boolean(payload?.persisted) });
      }
    });
  };

  return (
    <form onSubmit={submit} className={inline ? "grid gap-2" : "grid gap-3"}>
      {suggestedCategoryLabel ? (
        <p className="text-xs text-slate-400">
          AI suggested: <span className="text-slate-200">{suggestedCategoryLabel}</span>
        </p>
      ) : null}

      <Select
        value={categoryId}
        onChange={(event) => setCategoryId(event.target.value)}
        aria-label="Category"
      >
        <option value="">Choose category…</option>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
      </Select>

      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note (optional)"
        aria-label="Override note"
      />

      <div className={inline ? "flex items-center gap-2" : "grid gap-2"}>
        <div className={inline ? "flex-1" : ""}>
          <Select
            value={action}
            onChange={(event) => setAction(event.target.value as RuleAction)}
            aria-label="Learning action"
          >
            <option value="suggest">Suggest a rule</option>
            <option value="create">Create a rule now</option>
            <option value="none">Just this transaction</option>
          </Select>
        </div>
        <Button
          type="submit"
          variant="secondary"
          size={inline ? "sm" : "default"}
          disabled={isSaving || !categoryId}
          className={inline ? "shrink-0" : ""}
        >
          {isSaving ? "Saving…" : inline ? "Save" : "Save override"}
        </Button>
      </div>

      {willLearn && preview?.key === `${categoryId}|${action}` && preview.text ? (
        <p className="text-xs text-slate-400">{preview.text}</p>
      ) : null}
      {result ? <p className={toneClass[result.tone]}>{result.message}</p> : null}
    </form>
  );
}
