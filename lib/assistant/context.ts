import "server-only";

import {
  assistantStarterPrompts,
  dashboardGuides,
  internalFunctionGuides,
} from "@/lib/assistant/knowledge";
import {
  DEFAULT_ASSISTANT_MODEL,
  type DashboardAssistantContext,
} from "@/lib/assistant/types";
import { isBigQueryConfigured } from "@/lib/bigquery/client";
import { getCategoryInsights, getReviewQueue } from "@/lib/queries/categories";
import { getMerchantInsights } from "@/lib/queries/merchants";
import { getOverviewSnapshot } from "@/lib/queries/overview";
import { getRules } from "@/lib/queries/rules";
import { getRecentTransactions } from "@/lib/queries/transactions";
import {
  sampleCategoryInsights,
  sampleMerchantInsights,
  sampleOverview,
  sampleReviewQueue,
  sampleRules,
  sampleTransactions,
} from "@/lib/sample-data";
import { formatCurrency, formatPercent } from "@/lib/utils";

async function safeLoad<T>(loader: () => Promise<T>, fallback: T) {
  try {
    return await loader();
  } catch {
    return fallback;
  }
}

export async function getDashboardAssistantContext(): Promise<DashboardAssistantContext> {
  const warehouseConfigured = isBigQueryConfigured();
  const [overview, categories, merchants, rules, reviewQueue, recentTransactions] =
    await Promise.all([
      safeLoad(getOverviewSnapshot, sampleOverview),
      safeLoad(getCategoryInsights, sampleCategoryInsights),
      safeLoad(getMerchantInsights, sampleMerchantInsights),
      safeLoad(getRules, sampleRules),
      safeLoad(getReviewQueue, sampleReviewQueue),
      safeLoad(() => getRecentTransactions(8), sampleTransactions.slice(0, 8)),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    sourceMode: warehouseConfigured ? "warehouse" : "sample",
    overview,
    categories,
    merchants,
    rules,
    reviewQueue,
    recentTransactions,
    pageGuides: dashboardGuides,
    internalGuides: internalFunctionGuides,
  };
}

export function buildAssistantWelcomeMessage(context: DashboardAssistantContext) {
  const topCategory = context.categories[0];
  const topMerchant = context.merchants[0];
  const sampleLabel =
    context.sourceMode === "sample" ? "sample data mode" : "warehouse-backed mode";

  return [
    "I can explain the dashboard, summarize the current finance picture, and walk through imports, rules, overrides, and review workflows.",
    `Right now I see ${formatCurrency(context.overview.availableCash)} in available cash, ${context.reviewQueue.length} items in the review queue, and ${topCategory ? `${topCategory.label} at ${formatPercent(topCategory.share)} of spend` : "no category concentration yet"}.`,
    `The current largest expense is ${context.overview.largestExpense.merchant} at ${formatCurrency(-Math.abs(context.overview.largestExpense.amount))}, and ${topMerchant ? `${topMerchant.merchant} is the top merchant concentration.` : "merchant insight data is light right now."}`,
    `The assistant is reading ${sampleLabel}. Ask for a quick read, page walkthrough, or an explanation of how the internal classification flow works.`,
  ].join("\n\n");
}

export function getAssistantRuntimeStatus() {
  return {
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    openAiModel: process.env.OPENAI_MODEL ?? DEFAULT_ASSISTANT_MODEL,
    starterPrompts: [...assistantStarterPrompts],
  };
}
