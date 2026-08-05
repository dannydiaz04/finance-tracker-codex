type WarehouseRow = Record<string, unknown>;

type PlannedOverrideLike = {
  transactionId: string;
  plan: {
    overrideRow: WarehouseRow;
    ruleRow: WarehouseRow | null;
    ruleSuggestion: WarehouseRow | null;
    supersedeRuleId: string | null;
  };
};

type ExistingRuleLike = {
  id: string;
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  categoryId: string;
  categoryLabel: string;
  matchStrategy: string;
  matchValue: string;
  confidenceBoost: number;
  hitRate: number;
  lastMatchedAt?: string | null;
};

export type PendingRuleSuggestionRow = {
  suggestion_id: string;
  transaction_id: string | null;
  priority: number;
  category_id: string;
  category_label: string;
  match_strategy: string;
  match_value: string;
  rule_name: string;
  rule_description: string;
  source: string;
  note: string | null;
  created_at: string;
};

export type OverridePersistenceResult = {
  transactionId: string;
  persisted: boolean;
  rulePersisted: boolean;
  ruleError: string | null;
  ruleSuggestionPersisted: boolean;
  ruleSuggestionError: string | null;
};

export type OverridePersistenceDeps = {
  isConfigured: () => boolean;
  insertRows: (
    datasetId: string,
    tableId: string,
    rows: WarehouseRow[],
  ) => Promise<boolean>;
  getPendingSuggestionsForTransactions: (input: {
    userId: string;
    transactionIds: string[];
  }) => Promise<PendingRuleSuggestionRow[]>;
};

function disabledTombstone(rule: ExistingRuleLike, userId: string, now: string) {
  return {
    user_id: userId,
    rule_id: rule.id,
    name: rule.name,
    description: rule.description,
    priority: rule.priority,
    enabled: false,
    category_id: rule.categoryId,
    category_label: rule.categoryLabel,
    match_strategy: rule.matchStrategy,
    match_value: rule.matchValue,
    confidence_boost: rule.confidenceBoost,
    hit_rate: rule.hitRate,
    last_matched_at: rule.lastMatchedAt ?? null,
    created_at: now,
  };
}

export function createPersistOverridePlans(deps: OverridePersistenceDeps) {
  return async function persistOverridePlans(input: {
    userId: string;
    planned: PlannedOverrideLike[];
    existingRules: ExistingRuleLike[];
    now: string;
  }): Promise<OverridePersistenceResult[]> {
    const configured = deps.isConfigured();
    const overridePersisted = configured
      ? await deps.insertRows(
          "ops_finance",
          "manual_overrides",
          input.planned.map(({ plan }) => plan.overrideRow),
        )
      : false;

    const ruleRows = input.planned.flatMap(({ plan }) => {
      const rows: WarehouseRow[] = [];
      if (plan.supersedeRuleId) {
        const conflict = input.existingRules.find(
          (rule) => rule.id === plan.supersedeRuleId,
        );
        if (conflict) {
          rows.push(disabledTombstone(conflict, input.userId, input.now));
        }
      }
      if (plan.ruleRow) {
        rows.push(plan.ruleRow);
      }
      return rows;
    });

    let ruleRowsPersisted = false;
    let ruleError: string | null = null;
    if (configured && ruleRows.length > 0) {
      try {
        ruleRowsPersisted = await deps.insertRows(
          "ops_finance",
          "category_rules",
          ruleRows,
        );
      } catch (error) {
        ruleError =
          error instanceof Error ? error.message : "Unable to save rule changes.";
      }
    }

    const suggestionPlans = input.planned.filter(({ plan }) => plan.ruleSuggestion);
    let suggestionRowsPersisted = false;
    let ruleSuggestionError: string | null = null;
    if (configured && suggestionPlans.length > 0) {
      const transactionIds = suggestionPlans.map(({ transactionId }) => transactionId);
      const keepByTransaction = new Map(
        suggestionPlans.map(({ transactionId, plan }) => [
          transactionId,
          plan.ruleSuggestion!.suggestion_id,
        ]),
      );
      let staleRows: WarehouseRow[] = [];

      try {
        const pending = await deps.getPendingSuggestionsForTransactions({
          userId: input.userId,
          transactionIds,
        });
        staleRows = pending
          .filter(
            (row) =>
              row.transaction_id &&
              row.suggestion_id !== keepByTransaction.get(row.transaction_id),
          )
          .map((row) => ({
            user_id: input.userId,
            suggestion_id: row.suggestion_id,
            transaction_id: row.transaction_id,
            priority: row.priority,
            category_id: row.category_id,
            category_label: row.category_label,
            match_strategy: row.match_strategy,
            match_value: row.match_value,
            rule_name: row.rule_name,
            rule_description: row.rule_description,
            source: row.source,
            status: "superseded",
            note: row.note,
            created_at: row.created_at,
            updated_at: input.now,
            reviewed_at: input.now,
          }));
      } catch {
        // Best-effort cleanup: saving the new suggestions is still valuable.
      }

      try {
        const suggestionRows = suggestionPlans.map(
          ({ plan }) => plan.ruleSuggestion!,
        );

        suggestionRowsPersisted = await deps.insertRows(
          "ops_finance",
          "category_rule_suggestions",
          [...staleRows, ...suggestionRows],
        );
      } catch (error) {
        ruleSuggestionError =
          error instanceof Error ? error.message : "Unable to save rule suggestions.";
      }
    }

    return input.planned.map(({ transactionId, plan }) => {
      const hasRuleWrite = Boolean(plan.ruleRow || plan.supersedeRuleId);
      const hasSuggestionWrite = Boolean(plan.ruleSuggestion);

      return {
        transactionId,
        persisted: overridePersisted,
        rulePersisted: hasRuleWrite && ruleRowsPersisted,
        ruleError: hasRuleWrite ? ruleError : null,
        ruleSuggestionPersisted: hasSuggestionWrite && suggestionRowsPersisted,
        ruleSuggestionError: hasSuggestionWrite ? ruleSuggestionError : null,
      };
    });
  };
}
