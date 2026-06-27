"use client";

import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { cn } from "@/lib/utils";
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

const ADD_CATEGORY_VALUE = "__add_category__";
const NEW_CATEGORY_COLOR = "#22d3ee";

type NewCategoryDraft = {
  label: string;
  group: string;
  color: string;
};

const EMPTY_NEW_CATEGORY: NewCategoryDraft = {
  label: "",
  group: "",
  color: NEW_CATEGORY_COLOR,
};

export function OverrideForm({
  transactionId,
  currentCategoryId,
  suggestedCategoryLabel,
  categories,
  variant = "drawer",
  onResolved,
}: OverrideFormProps) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(() =>
    resolveDefaultCategoryId(currentCategoryId, categories),
  );
  const [note, setNote] = useState("");
  const [action, setAction] = useState<RuleAction>("suggest");
  const [preview, setPreview] = useState<{ key: string; text: string | null } | null>(null);
  const [result, setResult] = useState<{ tone: SaveResultTone; message: string } | null>(null);
  const [isSaving, startTransition] = useTransition();

  // Categories created inline from this form, merged over the server-provided list so
  // the new option is immediately selectable before the next refresh lands.
  const [addedCategories, setAddedCategories] = useState<Category[]>([]);
  const [creatingCategory, setCreatingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState<NewCategoryDraft>(EMPTY_NEW_CATEGORY);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, startCreating] = useTransition();

  const inline = variant === "inline";

  const categoryOptions = useMemo(() => {
    const byId = new Map<string, Category>();
    for (const category of categories) {
      byId.set(category.id, category);
    }
    for (const category of addedCategories) {
      byId.set(category.id, category);
    }
    return [...byId.values()];
  }, [categories, addedCategories]);

  const handleCategoryChange = (value: string) => {
    if (value === ADD_CATEGORY_VALUE) {
      setCreateError(null);
      setCreatingCategory(true);
      return;
    }
    setCategoryId(value);
  };

  const cancelCreateCategory = () => {
    setCreatingCategory(false);
    setCreateError(null);
    setNewCategory(EMPTY_NEW_CATEGORY);
  };

  const createCategory = () => {
    const label = newCategory.label.trim();
    const group = newCategory.group.trim();
    if (!label || !group) {
      setCreateError("Label and group are required.");
      return;
    }
    startCreating(async () => {
      setCreateError(null);
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, group, color: newCategory.color }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.category) {
        setCreateError(payload?.error ?? "Unable to create category.");
        return;
      }
      const created = payload.category as Category;
      setAddedCategories((current) => [...current, created]);
      setCategoryId(created.id);
      setCreatingCategory(false);
      setNewCategory(EMPTY_NEW_CATEGORY);
      router.refresh();
    });
  };
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
        <p className="break-words text-xs text-slate-400">
          AI suggested: <span className="break-words text-slate-200">{suggestedCategoryLabel}</span>
        </p>
      ) : null}

      <Select
        value={categoryId}
        onChange={(event) => handleCategoryChange(event.target.value)}
        aria-label="Category"
      >
        <option value="">Choose category…</option>
        {categoryOptions.map((category) => (
          <option key={category.id} value={category.id}>
            {category.label}
          </option>
        ))}
        <option value={ADD_CATEGORY_VALUE}>＋ Add new category…</option>
      </Select>

      {creatingCategory ? (
        <div className="grid gap-2 rounded-2xl border border-cyan-300/20 bg-cyan-400/[0.06] p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium text-white">
              <Plus className="size-3.5 text-cyan-300" />
              New category
            </p>
            <button
              type="button"
              aria-label="Cancel new category"
              onClick={cancelCreateCategory}
              className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <Input
            value={newCategory.label}
            onChange={(event) =>
              setNewCategory((current) => ({ ...current, label: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                createCategory();
              }
            }}
            placeholder="Label (e.g. Dining)"
            aria-label="New category label"
          />
          <div className="flex items-center gap-2">
            <Input
              value={newCategory.group}
              onChange={(event) =>
                setNewCategory((current) => ({ ...current, group: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createCategory();
                }
              }}
              placeholder="Group (e.g. Lifestyle)"
              aria-label="New category group"
              className="min-w-0 flex-1"
            />
            <input
              type="color"
              value={newCategory.color}
              onChange={(event) =>
                setNewCategory((current) => ({ ...current, color: event.target.value }))
              }
              className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-white/10 bg-transparent"
              aria-label="New category color"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                isCreating || !newCategory.label.trim() || !newCategory.group.trim()
              }
              onClick={createCategory}
            >
              {isCreating ? "Creating…" : "Create & select"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={cancelCreateCategory}>
              Cancel
            </Button>
          </div>
          {createError ? (
            <p className="break-words text-xs text-rose-200">{createError}</p>
          ) : null}
        </div>
      ) : null}

      <Input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Note (optional)"
        aria-label="Override note"
      />

      <div className={inline ? "flex items-center gap-2" : "grid gap-2"}>
        <div className={inline ? "min-w-0 flex-1" : "min-w-0"}>
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
        <p className="break-words text-xs text-slate-400">{preview.text}</p>
      ) : null}
      {result ? <p className={cn("break-words", toneClass[result.tone])}>{result.message}</p> : null}
    </form>
  );
}
