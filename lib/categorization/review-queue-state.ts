/**
 * Pure state helpers for the review queue. Kept out of the React component so batch
 * save transitions can be tested without loading Next/React.
 */

import {
  createOverrideDraft,
  describeSaveResult,
  type OverrideBatchResult,
  type OverrideDraft,
  type SaveResultTone,
} from "./override-form-state.ts";
import type {
  Category,
  ReviewQueueItem,
} from "@/lib/types/finance";

export type ReviewQueueResolution = {
  persisted: boolean;
  tone: SaveResultTone;
  message: string;
};

export type ReviewQueueNotice = {
  tone: SaveResultTone;
  message: string;
};

export function buildInitialReviewDrafts(
  items: ReviewQueueItem[],
  categories: Category[],
) {
  return Object.fromEntries(
    items.map((item) => [
      item.transactionId,
      createOverrideDraft(item.currentCategoryId, categories),
    ]),
  ) as Record<string, OverrideDraft>;
}

export function buildBatchResolutions(results: OverrideBatchResult[]) {
  return Object.fromEntries(
    results.map((result) => [
      result.transactionId,
      {
        persisted: Boolean(result.persisted),
        ...describeSaveResult({ ok: true, payload: result }),
      },
    ]),
  ) as Record<string, ReviewQueueResolution>;
}

export function getBatchResultIds(results: OverrideBatchResult[]) {
  return new Set(results.map((result) => result.transactionId));
}

export function removeReviewIds(
  transactionIds: Iterable<string>,
  idsToRemove: ReadonlySet<string>,
) {
  return new Set(
    [...transactionIds].filter((transactionId) => !idsToRemove.has(transactionId)),
  );
}

export function clearReviewErrors(
  errors: Record<string, string>,
  idsToRemove: ReadonlySet<string>,
) {
  return Object.fromEntries(
    Object.entries(errors).filter(
      ([transactionId]) => !idsToRemove.has(transactionId),
    ),
  );
}

export function describeBatchNotice(
  results: OverrideBatchResult[],
  resolutions: Record<string, ReviewQueueResolution>,
): ReviewQueueNotice {
  const tones = Object.values(resolutions).map((result) => result.tone);

  return {
    tone: tones.includes("partial")
      ? "partial"
      : tones.every((tone) => tone === "local")
        ? "local"
        : "success",
    message: tones.includes("partial")
      ? `Saved ${results.length} reviews; some rule actions need another attempt.`
      : `Saved ${results.length} review${results.length === 1 ? "" : "s"} in one batch.`,
  };
}
