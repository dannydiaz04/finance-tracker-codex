import { GitPullRequestDraft, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getLowConfidenceReviewItems, getRules } from "@/lib/queries/rules";

export default async function RulesPage() {
  const [rules, reviewItems] = await Promise.all([
    getRules(),
    getLowConfidenceReviewItems(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rules & Review"
        title="Tune the deterministic engine before letting AI handle edge cases."
        description="This page keeps the classification system auditable by exposing rule priority, hit-rate, and the rows waiting for human confirmation."
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
      </div>
    </div>
  );
}
