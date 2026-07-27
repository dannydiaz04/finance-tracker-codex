"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { normalizeCategoryGroupLabel } from "@/lib/categorization/category-group-catalog";
import type { Category, CategoryGroup } from "@/lib/types/finance";
import { cn } from "@/lib/utils";

type CategoryGroupManagerProps = {
  categoryGroups: CategoryGroup[];
  subcategories: Category[];
};

type DraftState = {
  categoryGroupId?: string;
  label: string;
  color: string;
  isSystem: boolean;
};

type FeedbackTone = "success" | "error";

const EMPTY_DRAFT: DraftState = {
  label: "",
  color: "#22c55e",
  isSystem: false,
};

function toDraft(categoryGroup: CategoryGroup): DraftState {
  return {
    categoryGroupId: categoryGroup.id,
    label: categoryGroup.label,
    color: categoryGroup.color || "#64748b",
    isSystem: Boolean(categoryGroup.isSystem),
  };
}

export function CategoryGroupManager({
  categoryGroups,
  subcategories,
}: CategoryGroupManagerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: FeedbackTone;
    message: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{
    categoryGroup: CategoryGroup;
    references: { subcategories: number };
    reassignTo: string;
  } | null>(null);
  const [isSaving, startSaving] = useTransition();

  const subcategoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const subcategory of subcategories) {
      const key = normalizeCategoryGroupLabel(subcategory.group);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [subcategories]);

  const reassignOptions = pendingDelete
    ? categoryGroups.filter(
        (group) => group.id !== pendingDelete.categoryGroup.id,
      )
    : [];

  const closePanel = () => {
    setOpen(false);
    setDraft(null);
    setPendingDelete(null);
    setFeedback(null);
  };

  const saveDraft = () => {
    if (!draft) return;

    startSaving(async () => {
      setFeedback(null);
      const response = await fetch("/api/category-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryGroupId: draft.categoryGroupId,
          label: draft.label,
          color: draft.color,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: payload?.error ?? "Unable to save category.",
        });
        return;
      }

      const movedMessage =
        payload.movedSubcategories > 0
          ? ` ${payload.movedSubcategories} subcategory(s) moved with it.`
          : "";
      setFeedback({
        tone: "success",
        message: draft.categoryGroupId
          ? `Category updated.${movedMessage}`
          : "Category created.",
      });
      setDraft(null);
      router.refresh();
    });
  };

  const requestDelete = (categoryGroup: CategoryGroup) => {
    setFeedback(null);
    startSaving(async () => {
      const response = await fetch("/api/category-groups", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryGroupId: categoryGroup.id }),
      });
      const payload = await response.json().catch(() => null);

      if (
        response.status === 409 &&
        payload?.status === "reassignment_required"
      ) {
        const fallback = categoryGroups.find(
          (group) => group.id !== categoryGroup.id,
        );
        setPendingDelete({
          categoryGroup,
          references: payload.references,
          reassignTo: fallback?.id ?? "",
        });
        return;
      }

      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: payload?.error ?? "Unable to delete category.",
        });
        return;
      }

      setFeedback({
        tone: "success",
        message: `Deleted "${categoryGroup.label}".`,
      });
      router.refresh();
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete || !pendingDelete.reassignTo) return;

    const { categoryGroup, reassignTo } = pendingDelete;
    startSaving(async () => {
      const response = await fetch("/api/category-groups", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryGroupId: categoryGroup.id,
          reassignTo,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setFeedback({
          tone: "error",
          message: payload?.error ?? "Unable to delete category.",
        });
        return;
      }

      const replacement = categoryGroups.find(
        (group) => group.id === reassignTo,
      );
      setFeedback({
        tone: "success",
        message: `Deleted "${categoryGroup.label}" and moved ${payload.movedSubcategories} subcategory(s) to "${replacement?.label ?? reassignTo}".`,
      });
      setPendingDelete(null);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Pencil className="size-4" />
        Manage categories
      </Button>

      <div
        className={cn(
          "fixed inset-0 z-50 overflow-hidden transition-all",
          open ? "pointer-events-auto" : "pointer-events-none",
        )}
        aria-hidden={!open}
      >
        <button
          type="button"
          aria-label="Close category manager"
          className={cn(
            "absolute inset-0 bg-slate-950/55 backdrop-blur-sm transition-opacity",
            open ? "opacity-100" : "opacity-0",
          )}
          onClick={closePanel}
        />

        <aside
          className={cn(
            "absolute right-0 top-0 flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-border bg-card transition-transform duration-300",
            open ? "translate-x-0" : "translate-x-full",
          )}
          aria-label="Category management"
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-5">
            <div className="min-w-0">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-emerald-500">
                Category catalog
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Add, rename, recolor, or remove parent categories. Renaming and
                reassignment move their subcategories without changing transaction
                or rule assignments.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Close"
              onClick={closePanel}
            >
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {feedback ? (
              <p
                className={cn(
                  "break-words rounded-sm border bg-background px-4 py-3 text-sm",
                  feedback.tone === "success"
                    ? "border-emerald-500/40 text-emerald-400"
                    : "border-red-500/40 text-red-400",
                )}
              >
                {feedback.message}
              </p>
            ) : null}

            {pendingDelete ? (
              <div className="space-y-3 rounded-sm border border-amber-500/40 bg-background p-4">
                <p className="text-sm font-medium text-amber-400">
                  Move subcategories before deleting “
                  {pendingDelete.categoryGroup.label}”
                </p>
                <p className="break-words text-xs text-amber-400/80">
                  {pendingDelete.references.subcategories} subcategory(s) belong
                  to this category. Pick a replacement category for them.
                </p>
                <Select
                  value={pendingDelete.reassignTo}
                  onChange={(event) =>
                    setPendingDelete((current) =>
                      current
                        ? { ...current, reassignTo: event.target.value }
                        : current,
                    )
                  }
                  aria-label="Move subcategories to category"
                >
                  {reassignOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSaving || !pendingDelete.reassignTo}
                    onClick={confirmDelete}
                  >
                    {isSaving ? "Working…" : "Move & delete"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPendingDelete(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            {draft ? (
              <div className="space-y-3 rounded-sm border border-border bg-background p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">
                    {draft.categoryGroupId ? "Edit category" : "New category"}
                  </p>
                  {draft.isSystem ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <Lock className="size-3" /> System
                    </span>
                  ) : null}
                </div>

                <label className="grid gap-1.5 text-xs uppercase tracking-[0.18em] text-slate-500">
                  Category
                  <Input
                    value={draft.label}
                    onChange={(event) =>
                      setDraft((current) =>
                        current
                          ? { ...current, label: event.target.value }
                          : current,
                      )
                    }
                    placeholder="e.g. Lifestyle"
                  />
                </label>

                <label className="grid gap-1.5 text-xs uppercase tracking-[0.18em] text-slate-500">
                  Color
                  <span className="flex items-center gap-3">
                    <input
                      type="color"
                      value={draft.color}
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? { ...current, color: event.target.value }
                            : current,
                        )
                      }
                      className="h-9 w-12 cursor-pointer rounded-sm border border-border bg-transparent"
                      aria-label="Category color"
                    />
                    <Input
                      value={draft.color}
                      onChange={(event) =>
                        setDraft((current) =>
                          current
                            ? { ...current, color: event.target.value }
                            : current,
                        )
                      }
                      className="flex-1"
                    />
                  </span>
                </label>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSaving || !draft.label.trim()}
                    onClick={saveDraft}
                  >
                    {isSaving ? "Saving…" : "Save category"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  setFeedback(null);
                  setDraft({ ...EMPTY_DRAFT });
                }}
              >
                <Plus className="size-4" />
                Add category
              </Button>
            )}

            <div className="space-y-2">
              {categoryGroups.map((categoryGroup) => (
                <div
                  key={categoryGroup.id}
                  className="flex items-center gap-3 rounded-sm border border-border bg-background px-3 py-2.5"
                >
                  <span
                    className="size-3 shrink-0 rounded-full ring-1 ring-white/20"
                    style={{
                      backgroundColor: categoryGroup.color || "#64748b",
                    }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-white">
                      {categoryGroup.label}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {subcategoryCounts.get(
                        normalizeCategoryGroupLabel(categoryGroup.label),
                      ) ?? 0}{" "}
                      subcategory(s)
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`Edit ${categoryGroup.label}`}
                    className="rounded-sm p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                    onClick={() => {
                      setFeedback(null);
                      setPendingDelete(null);
                      setDraft(toDraft(categoryGroup));
                    }}
                  >
                    <Pencil className="size-4" />
                  </button>
                  {categoryGroup.isSystem ? (
                    <span
                      className="rounded-sm p-1.5 text-slate-600"
                      title="System category — cannot be deleted"
                    >
                      <Lock className="size-4" />
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Delete ${categoryGroup.label}`}
                      disabled={isSaving}
                      className="rounded-sm p-1.5 text-slate-400 transition-colors hover:bg-red-500/15 hover:text-red-400 disabled:opacity-40"
                      onClick={() => requestDelete(categoryGroup)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
