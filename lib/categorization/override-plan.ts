import { normalizeMerchant } from "./normalize.ts";
import { buildRuleSuggestionDraft } from "./rule-suggestions.ts";
import type { Category, Rule, Transaction } from "../types/finance.ts";

/**
 * Pure orchestration for the editable review queue.
 *
 * Every rule write — pending suggestion or active rule — flows through `planOverride`
 * so guardrails, dedupe and the anti-rubber-stamp rule live in ONE place that can be
 * unit-tested with the repo's `node --test` runner (relative imports only; no
 * `next/server`, no `@/` alias, no DB). Routes stay thin adapters over this module.
 */

export type RuleAction = "none" | "suggest" | "create";
type MatchStrategy = Rule["matchStrategy"];

export class RuleGuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleGuardrailError";
  }
}

export const LEARNED_RULE_PRIORITY = 110;
export const LEARNED_RULE_CONFIDENCE = 0.95;

const MIN_CONTAINS_LENGTH = 4;
const MAX_REGEX_LENGTH = 200;

// Broad payment aggregators / processors whose substring would re-bucket unrelated
// charges. A `merchant_contains` on any of these is forced to `merchant_exact`.
const AGGREGATOR_DENYLIST = new Set([
  "uber",
  "amazon",
  "amazon prime",
  "amzn",
  "sq",
  "square",
  "paypal",
  "venmo",
  "apple",
  "apple com",
  "google",
  "cash app",
  "zelle",
  "afterpay",
  "klarna",
  "affirm",
  "toast",
]);

// ---------------------------------------------------------------------------
// resolveRuleAction — map the new 3-way param and the legacy boolean to one action.
// ---------------------------------------------------------------------------

export function resolveRuleAction(input: {
  ruleAction?: RuleAction | null;
  createRuleSuggestion?: boolean | null;
}): RuleAction {
  if (input.ruleAction) {
    return input.ruleAction;
  }
  // Legacy drawer contract: createRuleSuggestion defaulted true => suggest.
  if (input.createRuleSuggestion === false) {
    return "none";
  }
  return "suggest";
}

// ---------------------------------------------------------------------------
// applyRuleGuardrails — sanitize/constrain match_value before it can reach the
// warehouse matcher. Throws RuleGuardrailError on inputs that must be rejected.
// ---------------------------------------------------------------------------

export type GuardrailResult = {
  matchStrategy: MatchStrategy;
  matchValue: string;
  adjusted: boolean;
  reason: string | null;
};

export function applyRuleGuardrails(input: {
  matchStrategy: MatchStrategy;
  matchValue: string;
}): GuardrailResult {
  if (input.matchStrategy === "description_regex") {
    const value = input.matchValue.trim();
    if (!value) {
      throw new RuleGuardrailError("Regex match value is empty.");
    }
    if (value.length > MAX_REGEX_LENGTH) {
      throw new RuleGuardrailError(
        `Regex is too long (max ${MAX_REGEX_LENGTH} characters).`,
      );
    }
    try {
      // Validate the pattern compiles so a malformed rule can never fail the shared
      // fact_classification table build (regexp_contains throws at build time on
      // invalid RE2). JS and RE2 differ, but a syntactically valid JS regex screens
      // out the catastrophic cases ("(", "[", "*").
      new RegExp(value);
    } catch (error) {
      throw new RuleGuardrailError(
        `Invalid regular expression: ${
          error instanceof Error ? error.message : "unparseable"
        }.`,
      );
    }
    return { matchStrategy: "description_regex", matchValue: value, adjusted: false, reason: null };
  }

  // Merchant strategies: normalize so LIKE/substring metacharacters ('%', '_') and
  // punctuation can never reach the matcher, then constrain over-broad values.
  const normalized = normalizeMerchant(input.matchValue).trim();
  if (!normalized) {
    throw new RuleGuardrailError("Match value is empty after normalization.");
  }

  if (input.matchStrategy === "merchant_exact") {
    return { matchStrategy: "merchant_exact", matchValue: normalized, adjusted: false, reason: null };
  }

  if (AGGREGATOR_DENYLIST.has(normalized)) {
    return {
      matchStrategy: "merchant_exact",
      matchValue: normalized,
      adjusted: true,
      reason: `“${normalized}” is a broad payment aggregator; matching exactly so unrelated charges aren’t re-bucketed.`,
    };
  }

  if (normalized.length < MIN_CONTAINS_LENGTH) {
    return {
      matchStrategy: "merchant_exact",
      matchValue: normalized,
      adjusted: true,
      reason: `“${normalized}” is short; matching exactly to avoid an over-broad rule.`,
    };
  }

  return { matchStrategy: "merchant_contains", matchValue: normalized, adjusted: false, reason: null };
}

// ---------------------------------------------------------------------------
// dedupePlan — detect duplicate or contradictory rules. Keyed on the NORMALIZED
// match_value WITHOUT category_id so that two rules for the same merchant pointing at
// different categories are flagged as a `conflict`, never silently coexisting (which
// the priority ladder would then resolve non-deterministically).
// ---------------------------------------------------------------------------

export type DedupeStatus = "new" | "exists" | "conflict";

export type ExistingRule = {
  ruleId?: string | null;
  matchStrategy: MatchStrategy;
  matchValue: string;
  categoryId: string;
  enabled?: boolean | null;
};

export type DedupeResult = {
  status: DedupeStatus;
  conflictRuleId: string | null;
  conflictCategoryId: string | null;
};

function dedupeKey(matchStrategy: MatchStrategy, matchValue: string): string {
  // Regex rules are keyed by their raw pattern; merchant rules collapse the
  // exact/contains distinction onto the normalized value.
  return matchStrategy === "description_regex"
    ? `re:${matchValue.trim()}`
    : `m:${normalizeMerchant(matchValue).trim()}`;
}

export function dedupePlan(input: {
  existingRules: ExistingRule[];
  matchStrategy: MatchStrategy;
  matchValue: string;
  categoryId: string;
}): DedupeResult {
  const target = dedupeKey(input.matchStrategy, input.matchValue);

  for (const rule of input.existingRules) {
    if (rule.enabled === false) {
      continue;
    }
    if (dedupeKey(rule.matchStrategy, rule.matchValue) !== target) {
      continue;
    }
    if (rule.categoryId === input.categoryId) {
      return { status: "exists", conflictRuleId: rule.ruleId ?? null, conflictCategoryId: null };
    }
    return { status: "conflict", conflictRuleId: rule.ruleId ?? null, conflictCategoryId: rule.categoryId };
  }

  return { status: "new", conflictRuleId: null, conflictCategoryId: null };
}

// ---------------------------------------------------------------------------
// Row builders + preview
// ---------------------------------------------------------------------------

type RuleDraft = {
  categoryId: string;
  categoryLabel: string;
  matchStrategy: MatchStrategy;
  matchValue: string;
  ruleName: string;
  ruleDescription: string;
};

export function buildCategoryRuleRow(input: {
  userId: string;
  ruleId: string;
  draft: RuleDraft;
  now: string;
}) {
  return {
    user_id: input.userId,
    rule_id: input.ruleId,
    name: input.draft.ruleName,
    description: input.draft.ruleDescription,
    priority: LEARNED_RULE_PRIORITY,
    enabled: true,
    category_id: input.draft.categoryId,
    category_label: input.draft.categoryLabel,
    match_strategy: input.draft.matchStrategy,
    match_value: input.draft.matchValue,
    confidence_boost: LEARNED_RULE_CONFIDENCE,
    hit_rate: 0,
    last_matched_at: null,
    created_at: input.now,
  };
}

export function computeMatchPreview(input: {
  matchStrategy: MatchStrategy;
  matchValue: string;
  categoryLabel: string;
}): string {
  switch (input.matchStrategy) {
    case "merchant_exact":
      return `Auto-categorizes transactions whose merchant is exactly “${input.matchValue}” → ${input.categoryLabel}.`;
    case "merchant_contains":
      return `Auto-categorizes any transaction whose merchant contains “${input.matchValue}” → ${input.categoryLabel}.`;
    case "description_regex":
      return `Auto-categorizes transactions whose description matches /${input.matchValue}/ → ${input.categoryLabel}.`;
    default:
      return `Auto-categorizes matching transactions → ${input.categoryLabel}.`;
  }
}

// ---------------------------------------------------------------------------
// planOverride — the single chokepoint.
// ---------------------------------------------------------------------------

export type CategoryRuleSuggestionRow = {
  user_id: string;
  suggestion_id: string;
  transaction_id: string;
  category_id: string;
  category_label: string;
  match_strategy: MatchStrategy;
  match_value: string;
  rule_name: string;
  rule_description: string;
  source: string;
  status: "pending";
  note: string | null;
  created_at: string;
  updated_at: string;
  reviewed_at: null;
};

export type OverridePlan = {
  overrideRow: {
    user_id: string;
    transaction_id: string;
    category_id: string;
    reason: string;
    updated_at: string;
  };
  /** The action that actually took effect (may be downgraded to "none"). */
  ruleAction: RuleAction;
  ruleSuggestion: CategoryRuleSuggestionRow | null;
  ruleRow: ReturnType<typeof buildCategoryRuleRow> | null;
  /** When a `create` collides with a contradictory rule, the old rule to disable. */
  supersedeRuleId: string | null;
  dedupe: DedupeStatus;
  conflictCategoryId: string | null;
  matchPreview: string | null;
  /** The guarded (strategy, value) the rule/suggestion would use — for the dry-run count. */
  match: { matchStrategy: MatchStrategy; matchValue: string } | null;
  guardrailNote: string | null;
  /** False when the chosen category equals the current derived category (no learning). */
  categoryChanged: boolean;
};

type PlanTransaction = Pick<
  Transaction,
  | "transactionId"
  | "merchantRaw"
  | "merchantNorm"
  | "descriptionNorm"
  | "transactionClass"
  | "derivedCategoryId"
>;

export function planOverride(input: {
  userId: string;
  transaction: PlanTransaction;
  category: Pick<Category, "id" | "label">;
  action: RuleAction;
  note?: string | null;
  existingRules: ExistingRule[];
  now: string;
  suggestionId: string;
  ruleId: string;
}): OverridePlan {
  const note = input.note?.trim() ? input.note.trim() : null;
  const categoryChanged = input.transaction.derivedCategoryId !== input.category.id;

  const overrideRow = {
    user_id: input.userId,
    transaction_id: input.transaction.transactionId,
    category_id: input.category.id,
    reason: note ?? "Saved from review queue.",
    updated_at: input.now,
  };

  const empty = (
    ruleAction: RuleAction,
    guardrailNote: string | null = null,
  ): OverridePlan => ({
    overrideRow,
    ruleAction,
    ruleSuggestion: null,
    ruleRow: null,
    supersedeRuleId: null,
    dedupe: "new",
    conflictCategoryId: null,
    matchPreview: null,
    match: null,
    guardrailNote,
    categoryChanged,
  });

  // Anti-rubber-stamp: confirming the current category teaches nothing and must not
  // spawn a rule/suggestion (overrides also feed AI manualExamples — see Agent C 3.5).
  const effectiveAction: RuleAction = categoryChanged ? input.action : "none";
  if (effectiveAction === "none") {
    return empty("none", categoryChanged ? null : "Category unchanged — no rule learned.");
  }

  const draft = buildRuleSuggestionDraft({
    transaction: input.transaction,
    category: input.category,
    matchStrategy: "merchant_contains",
  });
  if (!draft) {
    // Internal categories (transfers / credit-card payments) cannot generalize.
    return empty("none", "This category can’t be turned into a rule.");
  }

  const guard = applyRuleGuardrails({
    matchStrategy: draft.matchStrategy,
    matchValue: draft.matchValue,
  });
  const finalDraft: RuleDraft = {
    ...draft,
    matchStrategy: guard.matchStrategy,
    matchValue: guard.matchValue,
  };
  const dedupe = dedupePlan({
    existingRules: input.existingRules,
    matchStrategy: guard.matchStrategy,
    matchValue: guard.matchValue,
    categoryId: input.category.id,
  });
  const matchPreview = computeMatchPreview({
    matchStrategy: guard.matchStrategy,
    matchValue: guard.matchValue,
    categoryLabel: input.category.label,
  });

  if (effectiveAction === "suggest") {
    // An identical active rule already exists — a pending suggestion would be noise.
    const ruleSuggestion: CategoryRuleSuggestionRow | null =
      dedupe.status === "exists"
        ? null
        : {
            user_id: input.userId,
            suggestion_id: input.suggestionId,
            transaction_id: input.transaction.transactionId,
            category_id: finalDraft.categoryId,
            category_label: finalDraft.categoryLabel,
            match_strategy: finalDraft.matchStrategy,
            match_value: finalDraft.matchValue,
            rule_name: finalDraft.ruleName,
            rule_description: finalDraft.ruleDescription,
            source: "manual_override",
            status: "pending",
            note,
            created_at: input.now,
            updated_at: input.now,
            reviewed_at: null,
          };
    return {
      overrideRow,
      ruleAction: "suggest",
      ruleSuggestion,
      ruleRow: null,
      supersedeRuleId: null,
      dedupe: dedupe.status,
      conflictCategoryId: dedupe.conflictCategoryId,
      matchPreview,
      match: { matchStrategy: guard.matchStrategy, matchValue: guard.matchValue },
      guardrailNote: guard.reason,
      categoryChanged,
    };
  }

  // effectiveAction === "create"
  const ruleRow =
    dedupe.status === "exists"
      ? null
      : buildCategoryRuleRow({ userId: input.userId, ruleId: input.ruleId, draft: finalDraft, now: input.now });
  return {
    overrideRow,
    ruleAction: "create",
    ruleSuggestion: null,
    ruleRow,
    supersedeRuleId: dedupe.status === "conflict" ? dedupe.conflictRuleId : null,
    dedupe: dedupe.status,
    conflictCategoryId: dedupe.conflictCategoryId,
    matchPreview,
    match: { matchStrategy: guard.matchStrategy, matchValue: guard.matchValue },
    guardrailNote: guard.reason,
    categoryChanged,
  };
}
