import "server-only";

import { scopeToTransactionFilters } from "@/lib/bigquery/params";
import { deriveMerchantInsightsFromTransactions } from "@/lib/queries/finance-aggregates";
import { getTransactions } from "@/lib/queries/transactions";
import type { TimeFilter } from "@/lib/time-filter";

export async function getMerchantInsights(timeFilter?: TimeFilter) {
  const transactions = await getTransactions(scopeToTransactionFilters(timeFilter));
  return deriveMerchantInsightsFromTransactions(transactions).slice(
    0,
    20,
  );
}
