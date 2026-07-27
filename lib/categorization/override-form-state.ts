/**
 * Pure presentation logic for the shared OverrideForm. Kept out of the React component
 * so it can be unit-tested under the repo's `node --test` runner (the component itself
 * imports next/navigation + React and isn't loadable there).
 */

export type RuleAction = "none" | "suggest" | "create";

export type OverrideSaveResponse = {
  persisted?: boolean;
  ruleAction?: RuleAction;
  ruleSuggestionPersisted?: boolean;
  ruleSuggestionError?: string | null;
  rulePersisted?: boolean;
  ruleError?: string | null;
  dedupe?: "new" | "exists" | "conflict";
  error?: string;
};

export type OverridePreviewResponse = {
  ruleAction?: RuleAction;
  dedupe?: "new" | "exists" | "conflict";
  conflictCategoryId?: string | null;
  matchPreview?: string | null;
  matchCount?: number | null;
  guardrailNote?: string | null;
};

export type SaveResultTone = "success" | "partial" | "local" | "error";

/**
 * Default the category select to the CURRENT derived category (so an explicit pick is a
 * real correction), but only if it's an actual option — never fall back to option[0],
 * and never pre-select the AI's suggested label.
 */
export function resolveDefaultCategoryId(
  currentCategoryId: string | null | undefined,
  categories: ReadonlyArray<{ id: string }>,
): string {
  if (!currentCategoryId) {
    return "";
  }
  return categories.some((category) => category.id === currentCategoryId)
    ? currentCategoryId
    : "";
}

/** Map an override POST response to a tone + message (success / partial / sample / error). */
export function describeSaveResult(input: {
  ok: boolean;
  payload: OverrideSaveResponse | null;
}): { tone: SaveResultTone; message: string } {
  const { ok, payload } = input;

  if (!ok || !payload) {
    return { tone: "error", message: payload?.error ?? "Unable to save override." };
  }

  if (payload.persisted === false) {
    return {
      tone: "local",
      message: "Saved locally — connect a warehouse to persist this override.",
    };
  }

  const action = payload.ruleAction ?? "none";

  if (action === "suggest") {
    if (payload.ruleSuggestionError) {
      return {
        tone: "partial",
        message: "Category saved, but the rule suggestion couldn’t be saved. Try again.",
      };
    }
    if (payload.ruleSuggestionPersisted) {
      return { tone: "success", message: "Saved — a learned rule is waiting for review." };
    }
    return { tone: "success", message: "Saved." };
  }

  if (action === "create") {
    if (payload.ruleError) {
      return {
        tone: "partial",
        message: "Category saved, but the rule couldn’t be saved. Try again.",
      };
    }
    if (payload.dedupe === "exists") {
      return { tone: "success", message: "Saved — a matching rule already exists." };
    }
    if (payload.rulePersisted) {
      return {
        tone: "success",
        message:
          payload.dedupe === "conflict"
            ? "Saved — the conflicting rule was replaced."
            : "Saved — a rule now auto-categorizes similar transactions.",
      };
    }
    return { tone: "success", message: "Saved." };
  }

  return { tone: "success", message: "Saved." };
}

/** Build the human preview line from a dryRun response (null when there's nothing to learn). */
export function describePreview(payload: OverridePreviewResponse | null): string | null {
  if (!payload || !payload.matchPreview) {
    return null;
  }

  const parts: string[] = [payload.matchPreview];

  if (typeof payload.matchCount === "number") {
    parts.push(
      `Matches ${payload.matchCount} of your existing transaction${
        payload.matchCount === 1 ? "" : "s"
      } (and future ones).`,
    );
  }
  if (payload.dedupe === "exists") {
    parts.push("A matching rule already exists.");
  }
  if (payload.dedupe === "conflict") {
    parts.push("A different rule already covers this merchant — saving will replace it.");
  }
  if (payload.guardrailNote) {
    parts.push(payload.guardrailNote);
  }

  return parts.join(" ");
}
