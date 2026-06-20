import "server-only";

import {
  detectCashflowAnomalies,
  type CashflowAlertThresholds,
  type CashflowAlertsResult,
} from "@/lib/alerts/cashflow-anomalies";
import { getCashflowSeries } from "@/lib/queries/cashflow";
import { getTransactions } from "@/lib/queries/transactions";
import type { TimeFilter } from "@/lib/time-filter";

// Composes the existing warehouse reads (which already fall back to sample data
// for unauthenticated / unconfigured environments) and runs the pure detector.
export async function getCashflowAlerts(
  timeFilter?: TimeFilter,
  thresholds?: Partial<CashflowAlertThresholds>,
): Promise<CashflowAlertsResult> {
  const [cashflow, transactions] = await Promise.all([
    getCashflowSeries(timeFilter),
    getTransactions({ from: timeFilter?.from, to: timeFilter?.to }),
  ]);

  return detectCashflowAnomalies({ cashflow, transactions, thresholds });
}
