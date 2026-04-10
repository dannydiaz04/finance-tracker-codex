import type { AssistantGuide } from "@/lib/assistant/types";

export const assistantStarterPrompts = [
  "Give me a quick read on the dashboard right now.",
  "What are the biggest spending drivers this month?",
  "How do I review and recategorize a transaction?",
  "Explain how rules, overrides, and the review queue work.",
] as const;

export const dashboardGuides: AssistantGuide[] = [
  {
    title: "Overview",
    summary:
      "The landing page combines current balance posture, month-to-date movement, category concentration, top merchants, and the active review queue.",
    examples: [
      "What should I focus on from the overview page?",
      "What does the largest current mover card mean?",
    ],
  },
  {
    title: "Transactions explorer",
    summary:
      "This view is for row-level investigation. Filters live in the URL, search suggestions come from the warehouse, and the drawer handles manual recategorization.",
    examples: [
      "How do I find all pending low-confidence transactions?",
      "How do I fix a miscategorized transaction?",
    ],
  },
  {
    title: "Cash Flow",
    summary:
      "Cash Flow separates inflow, outflow, and net so transfer-cleaned movement is visible before drilling into merchants or categories.",
    examples: [
      "What does the net card tell me?",
      "How should I use the daily movement chart?",
    ],
  },
  {
    title: "Categories",
    summary:
      "Categories shows spend mix, per-category transaction counts, trend, and the rows that still need confirmation.",
    examples: [
      "Why is one category dominating spend?",
      "What does the review queue on the categories page represent?",
    ],
  },
  {
    title: "Merchants",
    summary:
      "Merchants connects normalized merchant names to recurring-spend detection and rule-tuning opportunities.",
    examples: [
      "Which merchants look recurring?",
      "Why does merchant normalization matter?",
    ],
  },
  {
    title: "Rules & Review",
    summary:
      "This page exposes deterministic classification rules, their priority and hit-rate, plus the low-confidence queue that still needs a human decision.",
    examples: [
      "What is the difference between a rule and a review item?",
      "Where should I tune the deterministic engine?",
    ],
  },
];

export const internalFunctionGuides: AssistantGuide[] = [
  {
    title: "CSV import pipeline",
    summary:
      "CSV uploads are parsed through `/api/import/csv`, explicit source profiles resolve first with fallback header inference, rows are normalized, and preview mode can persist raw import batches and transaction events into BigQuery.",
    examples: [
      "How does CSV ingestion work?",
      "What columns are required for import?",
    ],
  },
  {
    title: "Normalization and classification",
    summary:
      "Descriptions and merchant names are cleaned before classification. Transaction class is inferred from amount and keywords, then deterministic rules run before institution hints and AI suggestions.",
    examples: [
      "How does the app decide expense vs transfer vs fee?",
      "What happens before a rule is applied?",
    ],
  },
  {
    title: "Overrides and replay",
    summary:
      "Manual transaction fixes post to `/api/categories/override`, land in `ops_finance.manual_overrides`, and are intended to replay back into the canonical fact table on the next warehouse pass.",
    examples: [
      "What happens when I save an override?",
      "How do manual fixes affect future reporting?",
    ],
  },
  {
    title: "Warehouse read model",
    summary:
      "Dashboard pages read from BigQuery marts and ops tables when configured, and fall back to curated sample data when they are not.",
    examples: [
      "Is this page reading sample data or warehouse data?",
      "Which tables back the dashboard?",
    ],
  },
  {
    title: "Plaid scaffolding",
    summary:
      "Plaid routes exist for link-token status and webhook intake, but the token exchange and sync loop are still scaffolded rather than fully implemented.",
    examples: [
      "How far along is Plaid integration?",
      "What does the webhook route do today?",
    ],
  },
];
