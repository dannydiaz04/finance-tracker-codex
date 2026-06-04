import { GitPullRequestDraft, Repeat2, ShieldCheck, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { TimeFilterSummary } from "@/components/dashboard/time-filter-summary";
import { RuleSuggestionActions } from "@/components/rules/rule-suggestion-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getInternalMovementReconciliationItems,
  getLowConfidenceReviewItems,
  getRuleSuggestions,
  getRules,
} from "@/lib/queries/rules";
import { normalizeTimeFilter } from "@/lib/time-filter";
import { formatCurrency } from "@/lib/utils";

type RulesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RulesPage({ searchParams }: RulesPageProps) {
  const timeFilter = normalizeTimeFilter(await searchParams);
  const [rules, reviewItems, ruleSuggestions, reconciliationItems] = await Promise.all([
    getRules(),
    getLowConfidenceReviewItems(timeFilter),
    getRuleSuggestions(),
    getInternalMovementReconciliationItems(timeFilter),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rules & Review"
        title="Tune the deterministic engine before letting AI handle edge cases."
        description="This page keeps the classification system auditable by exposing rule priority, hit-rate, and the rows waiting for human confirmation."
      />

      <TimeFilterSummary
        filter={timeFilter}
        fields="Review queue rows use transaction `postedAt` / warehouse `posted_at`; rule definitions are not date-filtered."
      />

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <ShieldCheck className="size-5 text-cyan-300" />
            <CardTitle>Category rules</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rules.map((rule) => (
              <div
                key={rule.id}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">{rule.name}</p>
                    <p className="mt-1 text-sm text-slate-400">{rule.description}</p>
                  </div>
                  <Badge>priority {rule.priority}</Badge>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-slate-300 md:grid-cols-3">
                  <p>Category: {rule.categoryLabel}</p>
                  <p>Strategy: {rule.matchStrategy.replace("_", " ")}</p>
                  <p>Hit rate: {(rule.hitRate * 100).toFixed(0)}%</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <Sparkles className="size-5 text-cyan-300" />
            <CardTitle>Learning suggestions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ruleSuggestions.map((suggestion) => (
              <div
                key={suggestion.suggestionId}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">{suggestion.ruleName}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {suggestion.ruleDescription}
                    </p>
                  </div>
                  <Badge>{suggestion.categoryLabel}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge>{suggestion.matchStrategy.replace("_", " ")}</Badge>
                  <Badge>{suggestion.matchValue}</Badge>
                </div>
                <div className="mt-4">
                  <RuleSuggestionActions suggestionId={suggestion.suggestionId} />
                </div>
              </div>
            ))}
            {ruleSuggestions.length === 0 ? (
              <p className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-6 text-sm text-slate-400">
                No pending learned rules.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <GitPullRequestDraft className="size-5 text-fuchsia-300" />
            <CardTitle>Review queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reviewItems.map((item) => (
              <div
                key={item.transactionId}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
              >
                <p className="font-medium text-white">{item.merchant}</p>
                <p className="mt-1 text-sm text-slate-400">{item.description}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge>{item.suggestedCategory}</Badge>
                  <Badge>{(item.confidenceScore * 100).toFixed(0)}% confidence</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <Repeat2 className="size-5 text-emerald-300" />
            <CardTitle>Internal movement reconciliation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reconciliationItems.map((item) => (
              <div
                key={item.transactionId}
                className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">{item.merchant}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {item.accountName} · {item.description}
                    </p>
                  </div>
                  <p className="shrink-0 font-medium text-white">
                    {formatCurrency(item.signedAmount)}
                  </p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge>{item.transactionClass.replace("_", " ")}</Badge>
                  <Badge>{item.matchStatus}</Badge>
                  <Badge>{item.postedAt}</Badge>
                </div>
              </div>
            ))}
            {reconciliationItems.length === 0 ? (
              <p className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-4 py-6 text-sm text-emerald-50">
                All visible accounting-only movements have a matching leg.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
