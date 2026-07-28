import { GitPullRequestDraft, Repeat2, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { TimeFilterSummary } from "@/components/dashboard/time-filter-summary";
import { ReviewQueue } from "@/components/rules/review-queue";
import { RuleCard } from "@/components/rules/rule-card";
import { RuleSuggestionPanel } from "@/components/rules/rule-suggestion-panel";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCategories, getCategoryGroups } from "@/lib/queries/catalog";
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
  const [rules, reviewItems, ruleSuggestions, reconciliationItems, categoryOptions] =
    await Promise.all([
      getRules(),
      getLowConfidenceReviewItems(timeFilter),
      getRuleSuggestions(),
      getInternalMovementReconciliationItems(timeFilter),
      getCategories(),
    ]);
  const categoryGroups = await getCategoryGroups(categoryOptions);

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
        <Card tone="balance">
          <CardHeader className="flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ShieldCheck className="size-5 text-emerald-500" />
              <div>
                <CardTitle>Active rules</CardTitle>
                <p className="mt-1 text-xs text-slate-500">
                  Accepted rules currently used by the categorization engine.
                </p>
              </div>
            </div>
            <Badge className="border-emerald-500/40 text-emerald-400">
              {rules.length} active
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {rules.map((rule) => (
              <RuleCard key={rule.id} rule={rule} categories={categoryOptions} />
            ))}
            {rules.length === 0 ? (
              <p className="rounded-sm border border-border bg-background px-4 py-6 text-sm text-slate-400">
                No active categorization rules yet.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <RuleSuggestionPanel
          key={ruleSuggestions.map((suggestion) => suggestion.suggestionId).join("|")}
          suggestions={ruleSuggestions}
          categories={categoryOptions}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <GitPullRequestDraft className="size-5 text-amber-400" />
            <CardTitle>Review queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReviewQueue
              items={reviewItems}
              categories={categoryOptions}
              categoryGroups={categoryGroups}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center gap-3">
            <Repeat2 className="size-5 text-emerald-500" />
            <CardTitle>Internal movement reconciliation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reconciliationItems.map((item) => (
              <div
                key={item.transactionId}
                className="rounded-sm border border-border bg-background px-4 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-white">{item.merchant}</p>
                    <p className="mt-1 text-sm text-slate-400">
                      {item.accountName} · {item.description}
                    </p>
                  </div>
                  <p className="shrink-0 font-mono font-medium text-white">
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
              <p className="rounded-sm border border-emerald-500/30 bg-background px-4 py-6 text-sm text-emerald-400">
                All visible accounting-only movements have a matching leg.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
