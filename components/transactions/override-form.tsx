"use client";

import { type FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { cn } from "@/lib/utils";
import {
  resolveCategoryGroup,
} from "@/lib/categorization/category-catalog";
import { normalizeCategoryGroupLabel } from "@/lib/categorization/category-group-catalog";
import {
  type RuleAction,
  type SaveResultTone,
  describePreview,
  describeSaveResult,
  resolveDefaultCategoryId,
} from "@/lib/categorization/override-form-state";
import type { Category, CategoryGroup } from "@/lib/types/finance";

type OverrideFormProps = {
  transactionId: string;
  /** Current derived category id — used as the default and the no-op guard. */
  currentCategoryId: string | null;
  /** AI/derived label shown read-only for context. Never pre-selected (anti-rubber-stamp). */
  suggestedCategoryLabel?: string | null;
  categories: Category[];
  categoryGroups: CategoryGroup[];
  variant?: "drawer" | "inline";
  onResolved?: (result: { persisted: boolean }) => void;
};

const toneClass: Record<SaveResultTone, string> = {
  success: "text-sm text-emerald-400",
  partial: "text-sm text-amber-400",
  local: "text-sm text-slate-300",
  error: "text-sm text-red-400",
};

const ADD_SUBCATEGORY_VALUE = "__add_subcategory__";
const NEW_SUBCATEGORY_COLOR = "#22c55e";

type NewSubcategoryDraft = {
  label: string;
  group: string;
  color: string;
};

const EMPTY_NEW_SUBCATEGORY: NewSubcategoryDraft = {
  label: "",
  group: "",
  color: NEW_SUBCATEGORY_COLOR,
};

export function OverrideForm({
  transactionId,
  currentCategoryId,
  suggestedCategoryLabel,
  categories,
  categoryGroups,
  variant = "drawer",
  onResolved,
}: OverrideFormProps) {
  const router = useRouter();
  const initialCategoryId = resolveDefaultCategoryId(currentCategoryId, categories);
  const resolvedCategoryGroup = resolveCategoryGroup(
    initialCategoryId,
    categories,
  );
  const initialCategoryGroup =
    categoryGroups.find(
      (group) =>
        normalizeCategoryGroupLabel(group.label) ===
        normalizeCategoryGroupLabel(resolvedCategoryGroup),
    )?.label ?? resolvedCategoryGroup;
  const [categoryId, setCategoryId] = useState(initialCategoryId);
  const [categoryGroup, setCategoryGroup] = useState(initialCategoryGroup);
  const [note, setNote] = useState("");
  const [action, setAction] = useState<RuleAction>("suggest");
  const [preview, setPreview] = useState<{ key: string; text: string | null } | null>(null);
  const [result, setResult] = useState<{ tone: SaveResultTone; message: string } | null>(null);
  const [isSaving, startTransition] = useTransition();

  // Subcategories created inline from this form, merged over the server-provided list so
  // the new option is immediately selectable before the next refresh lands.
  const [addedCategories, setAddedCategories] = useState<Category[]>([]);
  const [creatingSubcategory, setCreatingSubcategory] = useState(false);
  const [newSubcategory, setNewSubcategory] =
    useState<NewSubcategoryDraft>(EMPTY_NEW_SUBCATEGORY);
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

  const subcategoryOptions = useMemo(
    () =>
      categoryOptions.filter(
        (category) =>
          normalizeCategoryGroupLabel(category.group) ===
          normalizeCategoryGroupLabel(categoryGroup),
      ),
    [categoryOptions, categoryGroup],
  );

  const handleCategoryGroupChange = (value: string) => {
    setCategoryGroup(value);
    setCategoryId((current) =>
      categoryOptions.some(
        (category) =>
          category.id === current &&
          normalizeCategoryGroupLabel(category.group) ===
            normalizeCategoryGroupLabel(value),
      )
        ? current
        : "",
    );
  };

  const handleCategoryChange = (value: string) => {
    if (value === ADD_SUBCATEGORY_VALUE) {
      setCreateError(null);
      setNewSubcategory((current) => ({ ...current, group: categoryGroup }));
      setCreatingSubcategory(true);
      return;
    }
    setCategoryId(value);
  };

  const cancelCreateSubcategory = () => {
    setCreatingSubcategory(false);
    setCreateError(null);
    setNewSubcategory(EMPTY_NEW_SUBCATEGORY);
  };

  const createSubcategory = () => {
    const label = newSubcategory.label.trim();
    const group = newSubcategory.group.trim();
    if (!label || !group) {
      setCreateError("Category and subcategory are required.");
      return;
    }
    startCreating(async () => {
      setCreateError(null);
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, group, color: newSubcategory.color }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.category) {
        setCreateError(payload?.error ?? "Unable to create subcategory.");
        return;
      }
      const created = payload.category as Category;
      setAddedCategories((current) => [...current, created]);
      setCategoryGroup(created.group);
      setCategoryId(created.id);
      setCreatingSubcategory(false);
      setNewSubcategory(EMPTY_NEW_SUBCATEGORY);
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
      setResult({ tone: "error", message: "Choose a subcategory first." });
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

      <div className="grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1.5 text-xs uppercase tracking-[0.18em] text-slate-500">
          Category
          <Select
            value={categoryGroup}
            onChange={(event) => handleCategoryGroupChange(event.target.value)}
            aria-label="Category"
          >
            <option value="">Choose category…</option>
            {categoryGroups.map((group) => (
              <option key={group.id} value={group.label}>
                {group.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="grid gap-1.5 text-xs uppercase tracking-[0.18em] text-slate-500">
          Subcategory
          <Select
            value={categoryId}
            onChange={(event) => handleCategoryChange(event.target.value)}
            aria-label="Subcategory"
          >
            <option value="">
              {categoryGroup ? "Choose subcategory…" : "Choose category first…"}
            </option>
            {subcategoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.label}
                {category.sublabel ? ` — ${category.sublabel}` : ""}
              </option>
            ))}
            {categoryGroup ? (
              <option value={ADD_SUBCATEGORY_VALUE}>
                ＋ Add new subcategory…
              </option>
            ) : null}
          </Select>
        </label>
      </div>

      {creatingSubcategory ? (
        <div className="grid gap-2 rounded-sm border border-emerald-500/30 bg-background p-3">
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-medium text-white">
              <Plus className="size-3.5 text-emerald-500" />
              New subcategory
            </p>
            <button
              type="button"
              aria-label="Cancel new subcategory"
              onClick={cancelCreateSubcategory}
              className="rounded-sm p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <Input
            value={newSubcategory.label}
            onChange={(event) =>
              setNewSubcategory((current) => ({
                ...current,
                label: event.target.value,
              }))
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                createSubcategory();
              }
            }}
            placeholder="Subcategory (e.g. Dining)"
            aria-label="New subcategory"
          />
          <div className="flex items-center gap-2">
            <Select
              value={newSubcategory.group}
              onChange={(event) =>
                setNewSubcategory((current) => ({
                  ...current,
                  group: event.target.value,
                }))
              }
              aria-label="New subcategory category"
              className="min-w-0 flex-1"
            >
              <option value="">Choose category…</option>
              {categoryGroups.map((group) => (
                <option key={group.id} value={group.label}>
                  {group.label}
                </option>
              ))}
            </Select>
            <input
              type="color"
              value={newSubcategory.color}
              onChange={(event) =>
                setNewSubcategory((current) => ({
                  ...current,
                  color: event.target.value,
                }))
              }
              className="h-9 w-10 shrink-0 cursor-pointer rounded-sm border border-border bg-transparent"
              aria-label="New subcategory color"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={
                isCreating ||
                !newSubcategory.label.trim() ||
                !newSubcategory.group.trim()
              }
              onClick={createSubcategory}
            >
              {isCreating ? "Creating…" : "Create & select"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={cancelCreateSubcategory}
            >
              Cancel
            </Button>
          </div>
          {createError ? (
            <p className="break-words text-xs text-red-400">{createError}</p>
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
