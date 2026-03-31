import "server-only";

import type {
  AssistantChatMessage,
  DashboardAssistantContext,
} from "@/lib/assistant/types";
import { formatCompactCurrency, formatCurrency, formatPercent } from "@/lib/utils";

function getLatestUserMessage(messages: AssistantChatMessage[]) {
  return [...messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim();
}

function includesAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

function buildQuickRead(context: DashboardAssistantContext) {
  const topCategory = context.categories[0];
  const nextCategories = context.categories.slice(1, 3);
  const topMerchant = context.merchants[0];
  const lowConfidence = context.recentTransactions.filter(
    (transaction) => transaction.confidenceScore < 0.75,
  );
  const recentPending = context.recentTransactions.find(
    (transaction) => transaction.pending,
  );

  const lines = [
    "Quick read:",
    `- Total balance is ${formatCurrency(context.overview.totalBalance)} and available cash is ${formatCurrency(context.overview.availableCash)}.`,
    `- Month-to-date spend is ${formatCurrency(context.overview.monthToDateSpend)} against ${formatCurrency(context.overview.monthToDateIncome)} of income, with a ${formatPercent(context.overview.savingsRate)} savings rate.`,
  ];

  if (topCategory) {
    const supportingCategories = nextCategories
      .map((category) => `${category.label} ${formatPercent(category.share)}`)
      .join(", ");
    lines.push(
      `- ${topCategory.label} is the main spend driver at ${formatCurrency(topCategory.amount)} (${formatPercent(topCategory.share)} of tracked spend)${supportingCategories ? `, followed by ${supportingCategories}.` : "."}`,
    );
  }

  if (topMerchant) {
    lines.push(
      `- ${topMerchant.merchant} is the top merchant concentration at ${formatCurrency(topMerchant.spend)} across ${topMerchant.transactions} transactions${topMerchant.likelyRecurring ? " and it looks recurring." : "."}`,
    );
  }

  lines.push(
    `- The review queue has ${context.reviewQueue.length} item${context.reviewQueue.length === 1 ? "" : "s"}.`,
  );

  if (recentPending) {
    lines.push(
      `- The most immediate pending row is ${recentPending.merchantRaw} for ${formatCurrency(recentPending.signedAmount)} with ${(recentPending.confidenceScore * 100).toFixed(0)}% confidence.`,
    );
  } else if (lowConfidence[0]) {
    lines.push(
      `- The weakest recent classification is ${lowConfidence[0].merchantRaw} at ${(lowConfidence[0].confidenceScore * 100).toFixed(0)}% confidence.`,
    );
  }

  return lines.join("\n");
}

function buildUsageGuide(context: DashboardAssistantContext) {
  const lines = [
    "Use the dashboard like this:",
    "- Start on Overview for the big picture: balances, month-to-date movement, top category concentration, top merchants, and review queue pressure.",
    "- Move to Transactions when you need row-level search, filter combinations, or manual recategorization from the drawer.",
    "- Use Cash Flow when you want inflow, outflow, and net movement split apart before drilling into causes.",
    "- Use Categories and Merchants when you want pattern-finding: which buckets dominate spend, which merchants look recurring, and where normalization or new rules would help.",
    "- Use Rules & Review when you want to tune the deterministic engine and work the low-confidence queue.",
  ];

  if (context.reviewQueue[0]) {
    lines.push(
      `- Right now the first review item is ${context.reviewQueue[0].merchant} because ${context.reviewQueue[0].reason.toLowerCase()}.`,
    );
  }

  return lines.join("\n");
}

function buildOverviewReply(context: DashboardAssistantContext) {
  const topCategory = context.categories[0];
  const topMerchant = context.merchants[0];

  return [
    "Overview page:",
    "- This is the fastest read on overall posture: balances, month-to-date spend and income, current largest expense, category concentration, top merchants, and review queue pressure.",
    `- Right now the headline numbers are ${formatCurrency(context.overview.totalBalance)} total balance, ${formatCurrency(context.overview.availableCash)} available cash, and ${context.reviewQueue.length} review item${context.reviewQueue.length === 1 ? "" : "s"}.`,
    topCategory
      ? `- ${topCategory.label} is the leading category at ${formatPercent(topCategory.share)} of spend.`
      : "- Category concentration data is not populated yet.",
    topMerchant
      ? `- ${topMerchant.merchant} is the top merchant concentration to investigate next.`
      : "- Merchant concentration data is not populated yet.",
  ].join("\n");
}

function buildTransactionsReply(context: DashboardAssistantContext) {
  const lowConfidence = context.recentTransactions.filter(
    (transaction) => transaction.confidenceScore < 0.75,
  ).length;

  return [
    "Transactions explorer:",
    "- Use this page when you need row-level investigation instead of summary cards.",
    "- Filters live in the URL, so a view can be revisited or shared later.",
    "- Selecting a row opens the drawer, which shows classification history, raw payload, transfer links, and manual recategorization.",
    `- In the recent assistant context there are ${lowConfidence} low-confidence transaction${lowConfidence === 1 ? "" : "s"} worth checking.`,
  ].join("\n");
}

function buildTransactionWorkflowReply(context: DashboardAssistantContext) {
  const focusItem = context.reviewQueue[0];

  return [
    "To fix a transaction:",
    "- Open Transactions and filter until you find the row you want.",
    "- Select the row to open the drawer.",
    "- In Manual recategorization, choose the category and submit.",
    "- The app posts that change to `/api/categories/override`, which is intended to land in `ops_finance.manual_overrides` and replay into reporting on the next warehouse pass.",
    focusItem
      ? `- A good candidate right now is ${focusItem.merchant}, which is sitting in the review queue at ${(focusItem.confidenceScore * 100).toFixed(0)}% confidence.`
      : "- There are no obvious review-queue candidates at the moment.",
  ].join("\n");
}

function buildRulesReply(context: DashboardAssistantContext) {
  const highestPriorityRule = context.rules[0];

  return [
    "Rules & Review page:",
    "- This is where you tune the deterministic engine before relying on AI-only suggestions.",
    "- Each rule exposes category target, matching strategy, priority, and hit-rate so the system stays auditable.",
    `- The review queue currently has ${context.reviewQueue.length} item${context.reviewQueue.length === 1 ? "" : "s"} waiting for confirmation.`,
    highestPriorityRule
      ? `- The highest-priority visible rule is ${highestPriorityRule.name} at priority ${highestPriorityRule.priority}.`
      : "- There are no visible rules loaded right now.",
  ].join("\n");
}

function buildInternalWorkflowReply(context: DashboardAssistantContext) {
  const rulesSample = context.rules
    .slice(0, 3)
    .map((rule) => `${rule.name} (priority ${rule.priority})`)
    .join(", ");

  return [
    "Internally the app works in five layers:",
    "- Ingestion: `/api/import/csv` accepts JSON, multipart form uploads, or raw CSV text, infers column mapping, normalizes rows, and can persist raw import batches and transaction events.",
    "- Normalization: merchant names and descriptions are cleaned before keyword extraction and search indexing.",
    "- Classification: transaction class is inferred from amount and keywords, then deterministic category rules run before institution hints and AI suggestions.",
    `- Review loop: low-confidence rows flow into the review queue, and manual fixes post to overrides. The current deterministic rules surfaced here include ${rulesSample || "no rules yet"}.`,
    `- Read model: the dashboard reads BigQuery marts when configured and otherwise falls back to sample data. This session is in ${context.sourceMode} mode.`,
    "- Plaid: link-token status and webhook intake are scaffolded, but the full link-token exchange and sync loop are still not implemented.",
  ].join("\n");
}

function buildCashflowReply(context: DashboardAssistantContext) {
  const inflow = context.overview.cashflow.reduce((sum, point) => sum + point.inflow, 0);
  const outflow = context.overview.cashflow.reduce(
    (sum, point) => sum + point.outflow,
    0,
  );
  const net = context.overview.cashflow.reduce((sum, point) => sum + point.net, 0);

  return [
    "Cash flow read:",
    `- Inflow is ${formatCompactCurrency(inflow)}, outflow is ${formatCompactCurrency(outflow)}, and net movement is ${formatCompactCurrency(net)} over the visible window.`,
    "- The chart is most useful for spotting whether a bad month came from weak inflow, elevated outflow, or both.",
    "- Once you see the day or cluster that moved, switch to Transactions or Merchants to identify the driver.",
  ].join("\n");
}

function buildCategoryReply(context: DashboardAssistantContext) {
  const topCategories = context.categories
    .slice(0, 3)
    .map(
      (category) =>
        `${category.label}: ${formatCurrency(category.amount)} (${formatPercent(category.share)})`,
    )
    .join(", ");

  return [
    "Category view read:",
    `- The top categories right now are ${topCategories || "not available yet"}.`,
    "- This screen is where you decide whether concentration is real behavior or a classification issue.",
    `- The review queue has ${context.reviewQueue.length} item${context.reviewQueue.length === 1 ? "" : "s"}, so it is also the fastest place to see what still needs confirmation.`,
  ].join("\n");
}

function buildMerchantReply(context: DashboardAssistantContext) {
  const merchants = context.merchants
    .slice(0, 3)
    .map(
      (merchant) =>
        `${merchant.merchant}: ${formatCurrency(merchant.spend)} across ${merchant.transactions} txns`,
    )
    .join(", ");

  return [
    "Merchant view read:",
    `- The highest concentrations are ${merchants || "not available yet"}.`,
    "- Merchant normalization matters because it stabilizes search, recurring detection, and future rule creation.",
    "- If a merchant keeps showing up with the same cadence or description shape, it is a candidate for a deterministic rule rather than another AI-only suggestion.",
  ].join("\n");
}

export function generateLocalAssistantReply(
  messages: AssistantChatMessage[],
  context: DashboardAssistantContext,
) {
  const latestMessage = getLatestUserMessage(messages);

  if (!latestMessage) {
    return buildQuickRead(context);
  }

  const normalized = latestMessage.toLowerCase();

  if (
    includesAny(normalized, [
      "recategorize",
      "override",
      "fix transaction",
      "change category",
      "manual",
    ])
  ) {
    return buildTransactionWorkflowReply(context);
  }

  if (includesAny(normalized, ["overview", "home page", "landing page"])) {
    return buildOverviewReply(context);
  }

  if (includesAny(normalized, ["transaction", "transactions", "explorer"])) {
    return buildTransactionsReply(context);
  }

  if (includesAny(normalized, ["rules & review", "rules and review", "rule page"])) {
    return buildRulesReply(context);
  }

  if (
    includesAny(normalized, [
      "internal",
      "function",
      "workflow",
      "pipeline",
      "csv",
      "import",
      "plaid",
      "warehouse",
      "bigquery",
      "how does it work",
      "rules",
      "review queue",
      "review",
    ])
  ) {
    return buildInternalWorkflowReply(context);
  }

  if (includesAny(normalized, ["cash flow", "cashflow", "net movement", "inflow", "outflow"])) {
    return buildCashflowReply(context);
  }

  if (includesAny(normalized, ["category", "categories", "spend driver", "spending driver"])) {
    return buildCategoryReply(context);
  }

  if (includesAny(normalized, ["merchant", "recurring", "subscription", "alias"])) {
    return buildMerchantReply(context);
  }

  if (includesAny(normalized, ["how do i use", "how to use", "where should i", "dashboard"])) {
    return buildUsageGuide(context);
  }

  return buildQuickRead(context);
}
