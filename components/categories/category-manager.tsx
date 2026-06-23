"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Category } from "@/lib/types/finance";
import { cn } from "@/lib/utils";

type CategoryManagerProps = {
  categories: Category[];
};

type DraftState = {
  categoryId?: string;
  label: string;
  group: string;
  sublabel: string;
  color: string;
  isSystem: boolean;
};

type FeedbackTone = "success" | "error";

const EMPTY_DRAFT: DraftState = {
  label: "",
  group: "",
  sublabel: "",
  color: "#22d3ee",
  isSystem: false,
};

function toDraft(category: Category): DraftState {
  return {
    categoryId: category.id,
    label: category.label,
    group: category.group,
    sublabel: category.sublabel,
    color: category.color || "#64748b",
    isSystem: Boolean(category.isSystem),
  };
}

export function CategoryManager({ categories }: CategoryManagerProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [feedback, setFeedback] = useState<{ tone: FeedbackTone; message: string } | null>(
    null,
  );
  const [pendingDelete, setPendingDelete] = useState<{
    category: Category;
    references: { transactions: number; rules: number };
    reassignTo: string;
  } | null>(null);
  const [isSaving, startSaving] = useTransition();

  const grouped = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const category of categories) {
      const list = map.get(category.group) ?? [];
      list.push(category);
      map.set(category.group, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [categories]);

  const reassignOptions = pendingDelete
    ? categories.filter((item) => item.id !== pendingDelete.category.id)
    : [];

  const closePanel = () => {
    setOpen(false);
    setDraft(null);
    setPendingDelete(null);
    setFeedback(null);
  };

  const refresh = () => router.refresh();

  const saveDraft = () => {
    if (!draft) return;

    startSaving(async () => {
      setFeedback(null);
      const response = await fetch("/api/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          categoryId: draft.categoryId,
          label: draft.label,
          group: draft.group,
          sublabel: draft.sublabel,
          color: draft.color,
        }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setFeedback({ tone: "error", message: payload?.error ?? "Unable to save category." });
        return;
      }

      setFeedback({
        tone: "success",
        message: draft.categoryId ? "Category updated." : "Category created.",
      });
      setDraft(null);
      refresh();
    });
  };

  const requestDelete = (category: Category) => {
    setFeedback(null);
    startSaving(async () => {
      const response = await fetch("/api/categories", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId: category.id }),
      });
      const payload = await response.json().catch(() => null);

      if (response.status === 409 && payload?.status === "reassignment_required") {
        const fallback = categories.find((item) => item.id !== category.id);
        setPendingDelete({
          category,
          references: payload.references,
          reassignTo: fallback?.id ?? "",
        });
        return;
      }

      if (!response.ok) {
        setFeedback({ tone: "error", message: payload?.error ?? "Unable to delete category." });
        return;
      }

      setFeedback({ tone: "success", message: `Deleted "${category.label}".` });
      refresh();
    });
  };

  const confirmDelete = () => {
    if (!pendingDelete || !pendingDelete.reassignTo) return;

    const { category, reassignTo } = pendingDelete;
    startSaving(async () => {
      const response = await fetch("/api/categories", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId: category.id, reassignTo }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setFeedback({ tone: "error", message: payload?.error ?? "Unable to delete category." });
        return;
      }

      const target = categories.find((item) => item.id === reassignTo);
      setFeedback({
        tone: "success",
        message: `Deleted "${category.label}" and reassigned ${payload.reassignedTransactions} transaction(s) and ${payload.reassignedRules} rule(s) to "${target?.label ?? reassignTo}".`,
      });
      setPendingDelete(null);
      refresh();
    });
  };

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)} className="gap-2">
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
            "absolute right-0 top-0 flex h-full w-full max-w-lg flex-col overflow-hidden border-l border-white/10 bg-slate-950 shadow-[-24px_0_80px_rgba(2,6,23,0.55)] transition-transform duration-300",
            open ? "translate-x-0" : "translate-x-full",
          )}
          aria-label="Category management"
        >
          <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-5">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">
                Category catalog
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Add, rename, recolor, or remove categories. Edits are versioned and apply
                across rules, overrides, and dashboards.
              </p>
            </div>
            <Button variant="ghost" size="sm" aria-label="Close" onClick={closePanel}>
              <X className="size-4" />
            </Button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {feedback ? (
              <p
                className={cn(
                  "break-words rounded-2xl border px-4 py-3 text-sm",
                  feedback.tone === "success"
                    ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                    : "border-rose-300/20 bg-rose-300/10 text-rose-100",
                )}
              >
                {feedback.message}
              </p>
            ) : null}

            {pendingDelete ? (
              <div className="space-y-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
                <p className="text-sm font-medium text-amber-100">
                  Reassign before deleting “{pendingDelete.category.label}”
                </p>
                <p className="break-words text-xs text-amber-100/80">
                  {pendingDelete.references.transactions} transaction(s) and{" "}
                  {pendingDelete.references.rules} rule(s) currently use this category. Pick a
                  replacement to move them to.
                </p>
                <Select
                  value={pendingDelete.reassignTo}
                  onChange={(event) =>
                    setPendingDelete((current) =>
                      current ? { ...current, reassignTo: event.target.value } : current,
                    )
                  }
                  aria-label="Reassign to category"
                >
                  {reassignOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} · {option.group}
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
                    {isSaving ? "Working…" : "Reassign & delete"}
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
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">
                    {draft.categoryId ? "Edit category" : "New category"}
                  </p>
                  {draft.isSystem ? (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                      <Lock className="size-3" /> System
                    </span>
                  ) : null}
                </div>

                <label className="grid gap-1.5 text-xs uppercase tracking-[0.18em] text-slate-500">
                  Label
                  <Input
                    value={draft.label}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, label: event.target.value } : current,
                      )
                    }
                    placeholder="e.g. Dining"
                  />
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1.5 text-xs uppercase tracking-[0.18em] text-slate-500">
                    Group
                    <Input
                      value={draft.group}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, group: event.target.value } : current,
                        )
                      }
                      placeholder="e.g. Lifestyle"
                    />
                  </label>
                  <label className="grid gap-1.5 text-xs uppercase tracking-[0.18em] text-slate-500">
                    Subcategory
                    <Input
                      value={draft.sublabel}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, sublabel: event.target.value } : current,
                        )
                      }
                      placeholder="optional"
                    />
                  </label>
                </div>

                <label className="grid gap-1.5 text-xs uppercase tracking-[0.18em] text-slate-500">
                  Color
                  <span className="flex items-center gap-3">
                    <input
                      type="color"
                      value={draft.color}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, color: event.target.value } : current,
                        )
                      }
                      className="h-9 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
                      aria-label="Category color"
                    />
                    <Input
                      value={draft.color}
                      onChange={(event) =>
                        setDraft((current) =>
                          current ? { ...current, color: event.target.value } : current,
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
                    disabled={isSaving || !draft.label.trim() || !draft.group.trim()}
                    onClick={saveDraft}
                  >
                    {isSaving ? "Saving…" : "Save category"}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
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

            <div className="space-y-5">
              {grouped.map(([group, items]) => (
                <div key={group}>
                  <p className="mb-2 text-xs uppercase tracking-[0.22em] text-slate-500">
                    {group}
                  </p>
                  <div className="space-y-2">
                    {items.map((category) => (
                      <div
                        key={category.id}
                        className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                      >
                        <span
                          className="size-3 shrink-0 rounded-full ring-1 ring-white/20"
                          style={{ backgroundColor: category.color || "#64748b" }}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-white">{category.label}</p>
                          {category.sublabel ? (
                            <p className="truncate text-xs text-slate-500">
                              {category.sublabel}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          aria-label={`Edit ${category.label}`}
                          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                          onClick={() => {
                            setFeedback(null);
                            setPendingDelete(null);
                            setDraft(toDraft(category));
                          }}
                        >
                          <Pencil className="size-4" />
                        </button>
                        {category.isSystem ? (
                          <span
                            className="rounded-lg p-1.5 text-slate-600"
                            title="System category — cannot be deleted"
                          >
                            <Lock className="size-4" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Delete ${category.label}`}
                            disabled={isSaving}
                            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-rose-500/15 hover:text-rose-200 disabled:opacity-40"
                            onClick={() => requestDelete(category)}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
