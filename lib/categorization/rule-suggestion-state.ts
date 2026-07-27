/**
 * Pure presentation logic for the learned-rule suggestion card. Kept out of the React
 * component so it can be unit-tested under the repo's `node --test` runner (the component
 * itself imports next/navigation + React and isn't loadable there).
 */

import type { RuleSuggestion } from "@/lib/types/finance";

export type RuleSuggestionAction = "accept" | "dismiss" | "reopen";
export type RuleSuggestionReviewAction = Exclude<RuleSuggestionAction, "reopen">;

export type RuleSuggestionActionResponse = {
  status?: RuleSuggestion["status"];
  persisted?: boolean;
  dedupe?: "new" | "exists" | "conflict";
  revised?: boolean;
  error?: string;
};

export type RuleSuggestionResolution = {
  state: "accepted" | "dismissed";
  headline: string;
  detail: string;
};

/**
 * Map an accept/dismiss response to the card's confirmation copy. Accepted rules only
 * reach reports after the next warehouse refresh, so the detail line says so rather than
 * implying the change is already live.
 */
export function describeSuggestionResolution(input: {
  action: RuleSuggestionReviewAction;
  payload: RuleSuggestionActionResponse | null;
}): RuleSuggestionResolution {
  const { action, payload } = input;
  const persisted = payload?.persisted !== false;

  if (action === "dismiss") {
    return {
      state: "dismissed",
      headline: payload?.revised ? "Learned rule disabled" : "Dismissed",
      detail: payload?.revised
        ? "The reopened suggestion was dismissed and its learned rule was disabled. Any rule it previously replaced remains disabled."
        : persisted
          ? "This suggestion won’t come back to the queue."
          : "Dismissed locally — connect a warehouse to persist this.",
    };
  }

  if (!persisted) {
    return {
      state: "accepted",
      headline: "Accepted locally",
      detail: "Saved locally — connect a warehouse to persist this rule.",
    };
  }

  if (payload?.revised) {
    return {
      state: "accepted",
      headline: "Active rule updated",
      detail: "Your corrected review replaced the prior version of this learned rule.",
    };
  }

  if (payload?.dedupe === "exists") {
    return {
      state: "accepted",
      headline: "Already active",
      detail:
        "A matching rule already exists under Active rules, so nothing was duplicated.",
    };
  }

  return {
    state: "accepted",
    headline: "Moved to Active rules",
    detail:
      payload?.dedupe === "conflict"
        ? "The conflicting rule was replaced. This no longer needs review and matching transactions are refreshing in the background."
        : "This no longer needs review. You can edit it anytime under Active rules while matching transactions are refreshing in the background.",
  };
}

export function updateSuggestionReviewStatus(
  suggestion: RuleSuggestion,
  status: RuleSuggestion["status"],
  now: string,
): RuleSuggestion {
  return {
    ...suggestion,
    status,
    updatedAt: now,
    reviewedAt: status === "pending" ? null : now,
  };
}
