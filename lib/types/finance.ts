export type TransactionDirection = "inflow" | "outflow";

export type TransactionClass =
  | "expense"
  | "income"
  | "transfer"
  | "credit_payment"
  | "refund"
  | "fee"
  | "adjustment";

export type ClassificationSource =
  | "manual_override"
  | "merchant_rule"
  | "history"
  | "institution_category"
  | "ai_suggestion"
  | "fallback";

export type Category = {
  id: string;
  label: string;
  group: string;
  sublabel: string;
  color: string;
};

export type Account = {
  id: string;
  name: string;
  institution: string;
  type: "checking" | "savings" | "credit" | "brokerage";
  subtype: string;
  currency: string;
  mask: string;
  currentBalance: number;
  availableBalance: number;
};

export type TransactionEvent = {
  eventId: string;
  importBatchId: string;
  sourceName: "csv" | "plaid";
  sourceTransactionId: string;
  sourceAccountId: string;
  eventType: "added" | "modified" | "removed";
  eventTimestamp: string;
  payload: Record<string, unknown>;
};

export type ClassificationHistoryItem = {
  timestamp: string;
  source: ClassificationSource;
  confidenceScore: number;
  categoryId: string;
  categoryLabel: string;
  note: string;
};

export type Transaction = {
  transactionId: string;
  sourceTransactionId: string;
  canonicalGroupId: string;
  accountId: string;
  accountName: string;
  accountType: Account["type"];
  authorizedAt: string | null;
  postedAt: string;
  pending: boolean;
  direction: TransactionDirection;
  transactionClass: TransactionClass;
  signedAmount: number;
  merchantRaw: string;
  merchantNorm: string;
  descriptionRaw: string;
  descriptionNorm: string;
  institutionCategory: string | null;
  derivedCategoryId: string;
  categoryLabel: string;
  subcategoryId: string | null;
  confidenceScore: number;
  classificationSource: ClassificationSource;
  ruleId: string | null;
  isTransfer: boolean;
  isDuplicate: boolean;
  notes: string[];
  keywordArray: string[];
  rawPayloadJson: Record<string, unknown>;
  classificationHistory: ClassificationHistoryItem[];
};

export type TransactionDetail = Transaction & {
  relatedTransfers: Array<{
    transactionId: string;
    accountName: string;
    signedAmount: number;
    postedAt: string;
  }>;
  rawEvents: TransactionEvent[];
};

export type TransactionFilters = {
  query?: string;
  accountIds?: string[];
  categoryIds?: string[];
  merchant?: string;
  direction?: TransactionDirection | "all";
  transactionClass?: TransactionClass | "all";
  pending?: "all" | "pending" | "posted";
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
  selectedId?: string;
};

export type TransactionSearchSuggestion = {
  label: string;
  type: "merchant" | "category" | "keyword";
};

export type ImportBatch = {
  importBatchId: string;
  sourceName: "csv" | "plaid";
  importedAt: string;
  rowCount: number;
  status: "parsed" | "loaded" | "error";
  fileName: string;
};

export type CashflowPoint = {
  date: string;
  inflow: number;
  outflow: number;
  net: number;
};

export type CategorySpendPoint = {
  date: string;
  categoryId: string;
  categoryLabel: string;
  amount: number;
};

export type MerchantSpendPoint = {
  merchant: string;
  amount: number;
  transactions: number;
  changeVsPrior: number;
};

export type OverviewSnapshot = {
  totalBalance: number;
  availableCash: number;
  monthToDateSpend: number;
  monthToDateIncome: number;
  savingsRate: number;
  largestExpense: {
    merchant: string;
    amount: number;
    postedAt: string;
  };
  accounts: Account[];
  cashflow: CashflowPoint[];
  categoryMix: Array<{
    categoryId: string;
    label: string;
    amount: number;
    share: number;
  }>;
  topMerchants: MerchantSpendPoint[];
  reviewQueueCount: number;
};

export type Rule = {
  id: string;
  name: string;
  description: string;
  priority: number;
  enabled: boolean;
  categoryId: string;
  categoryLabel: string;
  matchStrategy: "merchant_exact" | "merchant_contains" | "description_regex";
  matchValue: string;
  confidenceBoost: number;
  hitRate: number;
  lastMatchedAt: string;
};

export type ReviewQueueItem = {
  transactionId: string;
  merchant: string;
  description: string;
  amount: number;
  postedAt: string;
  suggestedCategory: string;
  confidenceScore: number;
  reason: string;
};

export type MerchantInsight = {
  merchant: string;
  spend: number;
  transactions: number;
  trend: number;
  likelyRecurring: boolean;
};

export type CategoryInsight = {
  categoryId: string;
  label: string;
  amount: number;
  share: number;
  transactionCount: number;
  trend: number;
};
