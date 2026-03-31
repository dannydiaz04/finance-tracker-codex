import { ArrowRightLeft, DatabaseZap, ShieldCheck, Sparkles } from "lucide-react";

import { AssistantChat } from "@/components/assistant/assistant-chat";
import { PageHeader } from "@/components/dashboard/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  buildAssistantWelcomeMessage,
  getAssistantRuntimeStatus,
  getDashboardAssistantContext,
} from "@/lib/assistant/context";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/utils";

export default async function AssistantPage() {
  const context = await getDashboardAssistantContext();
  const runtime = getAssistantRuntimeStatus();
  const welcomeMessage = buildAssistantWelcomeMessage(context);
  const topCategory = context.categories[0];
  const topMerchant = context.merchants[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Assistant"
        title="Talk to the dashboard like an analyst, not a search box."
        description="This assistant can explain the product surface, inspect the current finance snapshot, and walk through internal behavior like imports, rules, overrides, and review flow."
        action={
          <div className="flex flex-wrap gap-2">
            <Badge
              className={
                runtime.openAiConfigured
                  ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-200"
                  : "border-amber-300/20 bg-amber-300/10 text-amber-50"
              }
            >
              {runtime.openAiConfigured ? "OpenAI ready" : "Local fallback"}
            </Badge>
            <Badge>
              {context.sourceMode === "warehouse" ? "Warehouse data" : "Sample data"}
            </Badge>
          </div>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <AssistantChat
          initialAssistantMessage={welcomeMessage}
          starterPrompts={runtime.starterPrompts}
          openAiConfigured={runtime.openAiConfigured}
          openAiModel={runtime.openAiModel}
          sourceMode={context.sourceMode}
        />

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Current signals</CardTitle>
              <CardDescription>
                The same finance context the assistant can reason over right now.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                  Available cash
                </p>
                <p className="mt-2 text-3xl font-semibold text-white">
                  {formatCompactCurrency(context.overview.availableCash)}
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Review queue
                  </p>
                  <p className="mt-2 text-2xl font-semibold text-white">
                    {context.reviewQueue.length} items
                  </p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Largest current mover
                  </p>
                  <p className="mt-2 font-medium text-white">
                    {context.overview.largestExpense.merchant}
                  </p>
                  <p className="mt-1 text-sm text-slate-400">
                    {formatCurrency(-Math.abs(context.overview.largestExpense.amount))}
                  </p>
                </div>
              </div>
              {topCategory ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Top category
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <p className="font-medium text-white">{topCategory.label}</p>
                    <Badge>{formatPercent(topCategory.share)}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-slate-400">
                    {formatCurrency(topCategory.amount)} across{" "}
                    {topCategory.transactionCount} transactions
                  </p>
                </div>
              ) : null}
              {topMerchant ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">
                    Top merchant
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-4">
                    <p className="font-medium text-white">{topMerchant.merchant}</p>
                    {topMerchant.likelyRecurring ? (
                      <Badge className="border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                        recurring
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm text-slate-400">
                    {formatCurrency(topMerchant.spend)} across {topMerchant.transactions}{" "}
                    transactions
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <Sparkles className="size-5 text-cyan-300" />
              <div>
                <CardTitle className="text-base">What it can explain</CardTitle>
                <CardDescription>
                  Product-level help grounded in the actual dashboard structure.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {context.pageGuides.slice(0, 4).map((guide) => (
                <div
                  key={guide.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <p className="font-medium text-white">{guide.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {guide.summary}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center gap-3">
              <ShieldCheck className="size-5 text-emerald-300" />
              <div>
                <CardTitle className="text-base">Internal flow</CardTitle>
                <CardDescription>
                  Ask about imports, rules, overrides, warehouse reads, and Plaid
                  scaffolding.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {context.internalGuides.map((guide, index) => (
                <div
                  key={guide.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
                >
                  <div className="flex items-center gap-3">
                    {index % 2 === 0 ? (
                      <DatabaseZap className="size-4 text-cyan-300" />
                    ) : (
                      <ArrowRightLeft className="size-4 text-fuchsia-300" />
                    )}
                    <p className="font-medium text-white">{guide.title}</p>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {guide.summary}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
