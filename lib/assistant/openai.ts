import "server-only";

import type {
  AssistantChatMessage,
  DashboardAssistantContext,
} from "@/lib/assistant/types";
import { DEFAULT_ASSISTANT_MODEL } from "@/lib/assistant/types";

type OpenAIResponsePayload = {
  output_text?: string;
  output?: Array<{
    content?: Array<{
      text?: string | { value?: string };
    }>;
  }>;
  error?: {
    message?: string;
  };
};

function formatGuides(title: string, guides: DashboardAssistantContext["pageGuides"]) {
  return [
    title,
    ...guides.map(
      (guide) =>
        `- ${guide.title}: ${guide.summary} Example questions: ${guide.examples.join(
          " | ",
        )}`,
    ),
  ].join("\n");
}

function buildContextPacket(context: DashboardAssistantContext) {
  return {
    generatedAt: context.generatedAt,
    sourceMode: context.sourceMode,
    overview: {
      totalBalance: context.overview.totalBalance,
      availableCash: context.overview.availableCash,
      monthToDateSpend: context.overview.monthToDateSpend,
      monthToDateIncome: context.overview.monthToDateIncome,
      savingsRate: context.overview.savingsRate,
      largestExpense: context.overview.largestExpense,
      reviewQueueCount: context.overview.reviewQueueCount,
      accounts: context.overview.accounts.map((account) => ({
        name: account.name,
        institution: account.institution,
        type: account.type,
        currentBalance: account.currentBalance,
        availableBalance: account.availableBalance,
      })),
    },
    categories: context.categories.slice(0, 6).map((category) => ({
      label: category.label,
      amount: category.amount,
      share: category.share,
      transactionCount: category.transactionCount,
      trend: category.trend,
    })),
    merchants: context.merchants.slice(0, 6).map((merchant) => ({
      merchant: merchant.merchant,
      spend: merchant.spend,
      transactions: merchant.transactions,
      trend: merchant.trend,
      likelyRecurring: merchant.likelyRecurring,
    })),
    rules: context.rules.slice(0, 6).map((rule) => ({
      name: rule.name,
      priority: rule.priority,
      categoryLabel: rule.categoryLabel,
      matchStrategy: rule.matchStrategy,
      hitRate: rule.hitRate,
      lastMatchedAt: rule.lastMatchedAt,
    })),
    reviewQueue: context.reviewQueue.slice(0, 6),
    recentTransactions: context.recentTransactions.map((transaction) => ({
      postedAt: transaction.postedAt,
      merchant: transaction.merchantRaw,
      amount: transaction.signedAmount,
      categoryLabel: transaction.categoryLabel,
      transactionClass: transaction.transactionClass,
      pending: transaction.pending,
      confidenceScore: transaction.confidenceScore,
      classificationSource: transaction.classificationSource,
    })),
  };
}

function buildConversationTranscript(messages: AssistantChatMessage[]) {
  return messages
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
}

function buildAssistantInstructions(context: DashboardAssistantContext) {
  return [
    "You are the in-product Finance Tracker assistant for a warehouse-first personal finance dashboard.",
    "Your job is to do three things well, each depending on what the user is asking for:",
    "1. Explain what each dashboard page does and how to use it.",
    "2. Analyze the provided finance data and offer grounded insights.",
    "3. Explain internal workflows like CSV import, normalization, deterministic rules, overrides, review queues, BigQuery reads, and Plaid scaffolding.",
    "Rules:",
    "- Use only the provided context. Do not invent missing metrics, pages, routes, or implementation details.",
    "- If the app is in sample mode, say that explicitly when it matters.",
    "- If a feature is scaffolded but incomplete, say so directly.",
    "- Keep answers practical and concise. Use bullets when it helps.",
    "- When a value is especially important to the answer, wrap just that value in <hl>...</hl>. Good candidates include money amounts, percentages, counts, dates, account names, and mode labels like sample mode.",
    "- Keep <hl> wrappers tight around the value only, not the surrounding sentence.",
    "- Do not use Markdown emphasis or other formatting syntax such as **bold**, backticks, or headings.",
    "- Tie observations to the data in context whenever you make a claim.",
    formatGuides("Dashboard pages:", context.pageGuides),
    formatGuides("Internal workflows:", context.internalGuides),
    `Current context JSON:\n${JSON.stringify(buildContextPacket(context), null, 2)}`,
  ].join("\n\n");
}

function extractOutputText(payload: OpenAIResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const content = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((part) => {
      if (typeof part.text === "string") {
        return part.text;
      }

      if (part.text && typeof part.text.value === "string") {
        return part.text.value;
      }

      return "";
    })
    .join("\n")
    .trim();

  return content || null;
}

export function isOpenAiConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function getOpenAiAssistantReply(
  messages: AssistantChatMessage[],
  context: DashboardAssistantContext,
) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL,
      instructions: buildAssistantInstructions(context),
      input: buildConversationTranscript(messages),
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const payload = (await response.json()) as OpenAIResponsePayload;

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "OpenAI assistant request failed.");
  }

  const content = extractOutputText(payload);

  if (!content) {
    throw new Error("OpenAI assistant response did not include text output.");
  }

  return {
    content,
    model: process.env.OPENAI_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL,
  };
}
