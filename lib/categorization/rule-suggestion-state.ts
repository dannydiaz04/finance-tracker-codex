/**
 * Pure presentation logic for the learned-rule suggestion card. Kept out of the React
 * component so it can be unit-tested under the repo's `node --test` runner (the component
 * itself imports next/navigation + React and isn't loadable there).
 */

export type RuleSuggestionAction = "accept" | "dismiss";

export type RuleSuggestionActionResponse = {
  status?: "accepted" | "dismissed";
  persisted?: boolean;
  dedupe?: "new" | "exists" | "conflict";
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
  action: RuleSuggestionAction;
  payload: RuleSuggestionActionResponse | null;
}): RuleSuggestionResolution {
  const { action, payload } = input;
  const persisted = payload?.persisted !== false;

  if (action === "dismiss") {
    return {
      state: "dismissed",
      headline: "Dismissed",
      detail: persisted
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
