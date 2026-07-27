"use client";

import { Pencil } from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

import { RuleSuggestionActions } from "@/components/rules/rule-suggestion-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { RuleSuggestionResolution } from "@/lib/categorization/rule-suggestion-state";
import type { Category, Rule, RuleSuggestion } from "@/lib/types/finance";

type RuleSuggestionCardProps = {
  suggestion: RuleSuggestion;
  categories: Category[];
  onUpdated?: (suggestion: RuleSuggestion) => void;
  onResolved?: (resolution: RuleSuggestionResolution) => void;
};

type SuggestionDraft = {
  ruleName: string;
  ruleDescription: string;
  priority: string;
  categoryId: string;
  matchStrategy: Rule["matchStrategy"];
  matchValue: string;
};

type EditableSuggestion = Pick<
  RuleSuggestion,
  | "ruleName"
  | "ruleDescription"
  | "priority"
  | "categoryId"
  | "categoryLabel"
  | "matchStrategy"
  | "matchValue"
>;

type SuggestionUpdateResponse = {
  persisted?: boolean;
  suggestion?: EditableSuggestion;
  guardrailNote?: string | null;
  error?: string;
};

function toDraft(suggestion: RuleSuggestion): SuggestionDraft {
  return {
    ruleName: suggestion.ruleName,
    ruleDescription: suggestion.ruleDescription,
    priority: String(suggestion.priority),
    categoryId: suggestion.categoryId,
    matchStrategy: suggestion.matchStrategy,
    matchValue: suggestion.matchValue,
  };
}

export function RuleSuggestionCard({
  suggestion,
  categories,
  onUpdated,
  onResolved,
}: RuleSuggestionCardProps) {
  const [draft, setDraft] = useState(() => toDraft(suggestion));
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState<{ tone: "success" | "error"; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const currentSubcategory = categories.find(
    (category) => category.id === suggestion.categoryId,
  );

  const openEditor = () => {
    setDraft(toDraft(suggestion));
    setResult(null);
    setEditing(true);
  };

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const priority = Number(draft.priority);
    if (!Number.isInteger(priority) || priority < 1) {
      setResult({ tone: "error", message: "Priority must be a positive whole number." });
      return;
    }

    setResult(null);
    startTransition(async () => {
      const response = await fetch(`/api/rule-suggestions/${suggestion.suggestionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...draft, priority }),
      });
      const payload = (await response.json().catch(() => null)) as
        | SuggestionUpdateResponse
        | null;

      if (!response.ok || !payload?.suggestion) {
        setResult({
          tone: "error",
          message: payload?.error ?? "Unable to update this suggestion.",
        });
        return;
      }

      const updated = { ...suggestion, ...payload.suggestion };
      setDraft(toDraft(updated));
      setEditing(false);
      setResult({
        tone: "success",
        message:
          payload.persisted === false
            ? "Updated locally — connect a warehouse to persist this suggestion."
            : ["Suggestion updated.", payload.guardrailNote].filter(Boolean).join(" "),
      });
      onUpdated?.(updated);
    });
  };

  return (
    <div className="rounded-sm border border-amber-500/30 bg-amber-500/[0.03] px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-medium text-white">{suggestion.ruleName}</p>
          <p className="mt-1 text-sm text-slate-400">{suggestion.ruleDescription}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <Badge>priority {suggestion.priority}</Badge>
          <Badge className="border-amber-500/40 text-amber-400">Needs review</Badge>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5"
            onClick={openEditor}
            disabled={editing || isPending}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        </div>
      </div>

      {editing ? (
        <form onSubmit={save} className="mt-4 grid gap-3 border-t border-border pt-4">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs text-slate-400">
              Rule name
              <Input
                value={draft.ruleName}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, ruleName: event.target.value }))
                }
                required
              />
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Priority
              <Input
                type="number"
                min={1}
                step={1}
                value={draft.priority}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, priority: event.target.value }))
                }
                required
              />
            </label>
          </div>

          <label className="grid gap-1 text-xs text-slate-400">
            Description
            <Input
              value={draft.ruleDescription}
              onChange={(event) =>
                setDraft((value) => ({ ...value, ruleDescription: event.target.value }))
              }
              required
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs text-slate-400">
              Subcategory
              <Select
                value={draft.categoryId}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, categoryId: event.target.value }))
                }
                required
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.group} — {category.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="grid gap-1 text-xs text-slate-400">
              Match strategy
              <Select
                value={draft.matchStrategy}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    matchStrategy: event.target.value as Rule["matchStrategy"],
                  }))
                }
              >
                <option value="merchant_exact">Merchant exactly matches</option>
                <option value="merchant_contains">Merchant contains</option>
                <option value="description_regex">Description regex</option>
              </Select>
            </label>
          </div>

          <label className="grid gap-1 text-xs text-slate-400">
            Match value
            <Input
              value={draft.matchValue}
              onChange={(event) =>
                setDraft((value) => ({ ...value, matchValue: event.target.value }))
              }
              required
            />
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
              {isPending ? "Saving…" : "Save changes"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isPending}
              onClick={() => {
                setDraft(toDraft(suggestion));
                setEditing(false);
                setResult(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>
              {currentSubcategory
                ? `${currentSubcategory.group} — ${currentSubcategory.label}`
                : suggestion.categoryLabel}
            </Badge>
            <Badge>{suggestion.matchStrategy.replaceAll("_", " ")}</Badge>
            <Badge>{suggestion.matchValue}</Badge>
          </div>
          <div className="mt-4">
            <RuleSuggestionActions
              suggestionId={suggestion.suggestionId}
              onResolved={onResolved}
            />
          </div>
        </>
      )}

      {result ? (
        <p
          className={
            result.tone === "success"
              ? "mt-3 text-xs text-emerald-400"
              : "mt-3 text-xs text-red-400"
          }
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
