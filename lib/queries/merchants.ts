import "server-only";

import { deriveMerchantInsightsFromTransactions } from "@/lib/queries/finance-aggregates";
import { getTransactions } from "@/lib/queries/transactions";
import type { TimeFilter } from "@/lib/time-filter";

export async function getMerchantInsights(timeFilter?: TimeFilter) {
  const transactions = await getTransactions({
    from: timeFilter?.from,
    to: timeFilter?.to,
  });
  return deriveMerchantInsightsFromTransactions(transactions).slice(
    0,
    20,
  );
}
