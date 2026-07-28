"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  ReviewQueueCard,
  type ReviewQueueResolution,
} from "@/components/rules/review-queue-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type OverrideBatchSaveResponse,
  type OverrideDraft,
  type SaveResultTone,
  createOverrideDraft,
  describeSaveResult,
} from "@/lib/categorization/override-form-state";
import type {
  Category,
  CategoryGroup,
  ReviewQueueItem,
} from "@/lib/types/finance";
import { cn } from "@/lib/utils";

type ReviewQueueProps = {
  items: ReviewQueueItem[];
  categories: Category[];
  categoryGroups: CategoryGroup[];
};

type ReviewMode = "individual" | "batch";

type Notice = {
  tone: SaveResultTone;
  message: string;
};

function initialDrafts(items: ReviewQueueItem[], categories: Category[]) {
  return Object.fromEntries(
    items.map((item) => [
      item.transactionId,
      createOverrideDraft(item.currentCategoryId, categories),
    ]),
  ) as Record<string, OverrideDraft>;
}

const noticeClass: Record<SaveResultTone, string> = {
  success: "border-emerald-500/30 text-emerald-400",
  partial: "border-amber-500/30 text-amber-400",
  local: "border-slate-600 text-slate-300",
  error: "border-red-500/30 text-red-400",
};

export function ReviewQueue({
  items,
  categories,
  categoryGroups,
}: ReviewQueueProps) {
  const router = useRouter();
  const [mode, setMode] = useState<ReviewMode>("individual");
  const [drafts, setDrafts] = useState(() => initialDrafts(items, categories));
  const [stagedIds, setStagedIds] = useState<Set<string>>(() => new Set());
  const [cardErrors, setCardErrors] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<
    Record<string, ReviewQueueResolution>
  >({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [resetVersion, setResetVersion] = useState(0);
  const [isSaving, startSaving] = useTransition();

  const stagedItems = useMemo(
    () => items.filter((item) => stagedIds.has(item.transactionId)),
    [items, stagedIds],
  );

  const getDraft = (item: ReviewQueueItem) =>
    drafts[item.transactionId] ??
    createOverrideDraft(item.currentCategoryId, categories);

  const updateDraft = (transactionId: string, draft: OverrideDraft) => {
    setDrafts((current) => ({ ...current, [transactionId]: draft }));
    setStagedIds((current) => new Set(current).add(transactionId));
    setCardErrors((current) => {
      const next = { ...current };
      delete next[transactionId];
      return next;
    });
    setResolutions((current) => {
      const next = { ...current };
      delete next[transactionId];
      return next;
    });
    setNotice(null);
  };

  const stageCurrent = (transactionId: string) => {
    const item = items.find((candidate) => candidate.transactionId === transactionId);
    if (!item || !getDraft(item).categoryId) {
      setCardErrors((current) => ({
        ...current,
        [transactionId]: "Choose a subcategory first.",
      }));
      return;
    }
    setStagedIds((current) => new Set(current).add(transactionId));
    setNotice(null);
  };

  const discardBatch = () => {
    setDrafts(initialDrafts(items, categories));
    setStagedIds(new Set());
    setCardErrors({});
    setNotice(null);
    setResetVersion((current) => current + 1);
  };

  const saveBatch = () => {
    const invalid = stagedItems.filter(
      (item) => !drafts[item.transactionId]?.categoryId,
    );
    if (invalid.length > 0) {
      setCardErrors((current) => ({
        ...current,
        ...Object.fromEntries(
          invalid.map((item) => [
            item.transactionId,
            "Choose a subcategory first.",
          ]),
        ),
      }));
      setNotice({
        tone: "error",
        message: "Choose a subcategory for every pending review.",
      });
      return;
    }

    startSaving(async () => {
      setNotice(null);
      try {
        const response = await fetch("/api/categories/overrides", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            overrides: stagedItems.map((item) => {
              const draft = getDraft(item);
              return {
                transactionId: item.transactionId,
                categoryId: draft.categoryId,
                note: draft.note.trim() || undefined,
                ruleAction: draft.ruleAction,
              };
            }),
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | OverrideBatchSaveResponse
          | null;

        if (!response.ok || !payload?.results) {
          setNotice({
            tone: "error",
            message: payload?.error ?? "Unable to save this review batch.",
          });
          return;
        }

        const nextResolutions = Object.fromEntries(
          payload.results.map((result) => [
            result.transactionId,
            {
              persisted: Boolean(result.persisted),
              ...describeSaveResult({ ok: true, payload: result }),
            },
          ]),
        ) as Record<string, ReviewQueueResolution>;
        const savedIds = new Set(payload.results.map((result) => result.transactionId));
        const tones = Object.values(nextResolutions).map((result) => result.tone);

        setResolutions((current) => ({ ...current, ...nextResolutions }));
        setStagedIds(
          (current) =>
            new Set([...current].filter((transactionId) => !savedIds.has(transactionId))),
        );
        setCardErrors((current) =>
          Object.fromEntries(
            Object.entries(current).filter(
              ([transactionId]) => !savedIds.has(transactionId),
            ),
          ),
        );
        setNotice({
          tone: tones.includes("partial")
            ? "partial"
            : tones.every((tone) => tone === "local")
              ? "local"
              : "success",
          message: tones.includes("partial")
            ? `Saved ${payload.results.length} reviews; some rule actions need another attempt.`
            : `Saved ${payload.results.length} review${
                payload.results.length === 1 ? "" : "s"
              } in one batch.`,
        });
        router.refresh();
      } catch {
        setNotice({
          tone: "error",
          message: "Unable to reach the server. Your pending reviews are still staged.",
        });
      }
    });
  };

  const recordIndividualResolution = (
    transactionId: string,
    result: { persisted: boolean },
  ) => {
    setResolutions((current) => ({
      ...current,
      [transactionId]: {
        persisted: result.persisted,
        tone: result.persisted ? "success" : "local",
        message: result.persisted
          ? "Removed from the queue; reflected in reports on the next warehouse refresh."
          : "Saved locally — connect a warehouse to persist this override.",
      },
    }));
    router.refresh();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-background px-3 py-3">
        <div>
          <p className="text-sm font-medium text-white">Save behavior</p>
          <p className="mt-1 text-xs text-slate-500">
            Save each review now or stage several changes for one backend write.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-sm border border-border p-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "individual" ? "secondary" : "ghost"}
            aria-pressed={mode === "individual"}
            disabled={mode === "batch" && stagedItems.length > 0}
            title={
              mode === "batch" && stagedItems.length > 0
                ? "Save or discard pending reviews before changing modes."
                : undefined
            }
            onClick={() => setMode("individual")}
          >
            Individual
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "batch" ? "secondary" : "ghost"}
            aria-pressed={mode === "batch"}
            onClick={() => setMode("batch")}
          >
            Batch review
          </Button>
        </div>
      </div>

      {mode === "batch" ? (
        <p className="px-1 text-xs text-slate-500">
          Editing any field adds that transaction to the batch. Use “Keep current”
          to review an unchanged transaction explicitly.
        </p>
      ) : null}

      {items.map((item) => (
        <ReviewQueueCard
          key={`${item.transactionId}:${resetVersion}`}
          item={item}
          categories={categories}
          categoryGroups={categoryGroups}
          saveMode={mode}
          draft={getDraft(item)}
          isStaged={stagedIds.has(item.transactionId)}
          batchError={cardErrors[item.transactionId]}
          batchResolution={resolutions[item.transactionId]}
          onDraftChange={(draft) => updateDraft(item.transactionId, draft)}
          onStage={() => stageCurrent(item.transactionId)}
          onIndividualResolved={(result) =>
            recordIndividualResolution(item.transactionId, result)
          }
          onIndividualReopen={() =>
            setResolutions((current) => {
              const next = { ...current };
              delete next[item.transactionId];
              return next;
            })
          }
        />
      ))}

      {items.length === 0 ? (
        <p className="rounded-sm border border-emerald-500/30 bg-background px-4 py-6 text-sm text-emerald-400">
          Review queue clear — no transactions need confirmation.
        </p>
      ) : null}

      {mode === "batch" ? (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-sm border border-amber-500/30 bg-slate-950/95 px-4 py-3 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <Badge className="border-amber-500/40 text-amber-400">
              {stagedItems.length} pending
            </Badge>
            <p className="text-xs text-slate-400">
              {stagedItems.length > 0
                ? "Nothing is written until you save the batch."
                : "Edit a card or keep its current category to begin."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSaving || stagedItems.length === 0}
              onClick={discardBatch}
            >
              Discard
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSaving || stagedItems.length === 0}
              onClick={saveBatch}
            >
              {isSaving
                ? "Saving…"
                : `Save ${stagedItems.length} review${
                    stagedItems.length === 1 ? "" : "s"
                  }`}
            </Button>
          </div>
        </div>
      ) : null}

      {notice ? (
        <p
          className={cn(
            "rounded-sm border bg-background px-4 py-3 text-sm",
            noticeClass[notice.tone],
          )}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.message}
        </p>
      ) : null}
    </div>
  );
}
