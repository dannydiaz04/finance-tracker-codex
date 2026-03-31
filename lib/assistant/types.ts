import type {
  CategoryInsight,
  MerchantInsight,
  OverviewSnapshot,
  ReviewQueueItem,
  Rule,
  Transaction,
} from "@/lib/types/finance";

export const DEFAULT_ASSISTANT_MODEL = "gpt-5.2";

export type AssistantChatRole = "user" | "assistant";

export type AssistantChatMessage = {
  role: AssistantChatRole;
  content: string;
};

export type AssistantReplyMode = "openai" | "local_fallback";

export type AssistantDataSourceMode = "warehouse" | "sample";

export type AssistantGuide = {
  title: string;
  summary: string;
  examples: string[];
};

export type DashboardAssistantContext = {
  generatedAt: string;
  sourceMode: AssistantDataSourceMode;
  sourceDetail: string;
  overview: OverviewSnapshot;
  categories: CategoryInsight[];
  merchants: MerchantInsight[];
  rules: Rule[];
  reviewQueue: ReviewQueueItem[];
  recentTransactions: Transaction[];
  pageGuides: AssistantGuide[];
  internalGuides: AssistantGuide[];
};

export type AssistantRouteResponse = {
  reply: AssistantChatMessage;
  mode: AssistantReplyMode;
  sourceMode: AssistantDataSourceMode;
  model: string | null;
  warning?: string;
};
