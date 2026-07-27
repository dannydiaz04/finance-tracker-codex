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
      headline: "dismissed",
      detail: persisted
        ? "This suggestion won’t come back to the queue."
        : "Dismissed locally — connect a warehouse to persist this.",
    };
  }

  if (!persisted) {
    return {
      headline: "accepted",
      detail: "Saved locally — connect a warehouse to persist this rule.",
    };
  }

  if (payload?.dedupe === "exists") {
    return {
      headline: "accepted",
      detail: "A matching rule already exists, so nothing was duplicated.",
    };
  }

  return {
    headline: "rule saved",
    detail:
      payload?.dedupe === "conflict"
        ? "The conflicting rule was replaced; similar transactions are recategorized on the next warehouse refresh."
        : "Similar transactions are categorized on the next warehouse refresh.",
  };
}
