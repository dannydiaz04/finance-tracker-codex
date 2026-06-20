import type { CashflowPoint, Transaction } from "@/lib/types/finance";

// Pure, dependency-free anomaly detection over cash flow.
//
// This module intentionally has no warehouse, network, or `Date.now()`
// dependencies so it can be unit tested deterministically and reused on both
// warehouse data and the sample dataset. The query layer
// (`lib/queries/alerts.ts`) is responsible for sourcing the inputs.

export type CashflowAlertSeverity = "info" | "warning" | "critical";

export type CashflowAlertType =
  | "large_transaction"
  | "outflow_spike"
  | "net_negative_streak"
  | "negative_cashflow";

export type CashflowAlert = {
  id: string;
  type: CashflowAlertType;
  severity: CashflowAlertSeverity;
  title: string;
  detail: string;
  /** Representative amount, signed (outflows negative) for direct formatting. */
  amount: number;
  /** Representative date (streak/window start). */
  date: string;
  /** End date for range-based alerts (streaks, windows). */
  endDate?: string;
  /** The ratio / magnitude that drove the alert, for transparency. */
  metric: number;
  transactionId?: string;
};

export type CashflowAlertsSummary = {
  total: number;
  critical: number;
  warning: number;
  info: number;
  windowFrom: string | null;
  windowTo: string | null;
};

export type CashflowAlertsResult = {
  alerts: CashflowAlert[];
  summary: CashflowAlertsSummary;
};

export type CashflowAlertThresholds = {
  /** A single charge this many times the median spend is "large". */
  largeTxnRatio: number;
  /** ...but only above this absolute floor (ignore noisy small spend). */
  largeTxnAbsoluteFloor: number;
  /** A day whose outflow is this many times the mean daily outflow spikes. */
  outflowSpikeRatio: number;
  outflowSpikeAbsoluteFloor: number;
  /** Consecutive negative-net points needed to flag a drawdown streak. */
  streakMinLength: number;
  /** ...and the minimum cumulative drawdown (absolute) to bother reporting. */
  streakMinDrawdown: number;
  /** Net cash flow over the window below -this (absolute) is abnormal burn. */
  negativeCashflowMinNet: number;
  /** Hard cap on emitted alerts so the UI stays scannable. */
  maxAlerts: number;
};

export const DEFAULT_CASHFLOW_ALERT_THRESHOLDS: CashflowAlertThresholds = {
  largeTxnRatio: 4,
  largeTxnAbsoluteFloor: 250,
  outflowSpikeRatio: 3,
  outflowSpikeAbsoluteFloor: 500,
  streakMinLength: 3,
  streakMinDrawdown: 1000,
  negativeCashflowMinNet: 1000,
  maxAlerts: 12,
};

export type DetectCashflowAnomaliesInput = {
  cashflow: CashflowPoint[];
  transactions?: Transaction[];
  thresholds?: Partial<CashflowAlertThresholds>;
};

const SEVERITY_RANK: Record<CashflowAlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

// Spend classes that count toward "cash flow"; transfers and credit-card
// payments are accounting-only movements (and are already excluded from the
// daily_cashflow mart), so they should not raise spending alerts.
const SPEND_EXCLUDED_CLASSES = new Set(["transfer", "credit_payment"]);

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function mean(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function detectLargeTransactions(
  transactions: Transaction[],
  thresholds: CashflowAlertThresholds,
): CashflowAlert[] {
  const spend = transactions.filter(
    (transaction) =>
      transaction.direction === "outflow" &&
      !SPEND_EXCLUDED_CLASSES.has(transaction.transactionClass),
  );

  if (spend.length < 3) {
    return [];
  }

  const magnitudes = spend.map((transaction) => Math.abs(transaction.signedAmount));
  const medianSpend = median(magnitudes);

  if (medianSpend <= 0) {
    return [];
  }

  return spend.flatMap((transaction): CashflowAlert[] => {
    const magnitude = Math.abs(transaction.signedAmount);
    const ratio = magnitude / medianSpend;

    if (magnitude < thresholds.largeTxnAbsoluteFloor || ratio < thresholds.largeTxnRatio) {
      return [];
    }

    const severity: CashflowAlertSeverity =
      ratio >= thresholds.largeTxnRatio * 2 ? "critical" : "warning";
    const merchant =
      transaction.merchantRaw || transaction.merchantNorm || "Unknown merchant";

    return [
      {
        id: `large_transaction:${transaction.transactionId}`,
        type: "large_transaction",
        severity,
        title: `Unusually large charge at ${merchant}`,
        detail: `${merchant} is ${round2(ratio)}x your typical ${transaction.categoryLabel || "spend"} transaction.`,
        amount: -magnitude,
        date: transaction.postedAt,
        metric: round2(ratio),
        transactionId: transaction.transactionId,
      },
    ];
  });
}

function detectOutflowSpikes(
  cashflow: CashflowPoint[],
  thresholds: CashflowAlertThresholds,
  explainedDates: Set<string>,
): CashflowAlert[] {
  const outflowDays = cashflow.filter((point) => point.outflow > 0);

  if (outflowDays.length < 3) {
    return [];
  }

  const meanOutflow = mean(outflowDays.map((point) => point.outflow));

  if (meanOutflow <= 0) {
    return [];
  }

  return outflowDays.flatMap((point): CashflowAlert[] => {
    const ratio = point.outflow / meanOutflow;

    if (
      point.outflow < thresholds.outflowSpikeAbsoluteFloor ||
      ratio < thresholds.outflowSpikeRatio ||
      // A single large charge already explains this day's spike.
      explainedDates.has(point.date)
    ) {
      return [];
    }

    const severity: CashflowAlertSeverity =
      ratio >= thresholds.outflowSpikeRatio * 2 ? "critical" : "warning";

    return [
      {
        id: `outflow_spike:${point.date}`,
        type: "outflow_spike",
        severity,
        title: `Spending spike on ${point.date}`,
        detail: `Outflow was ${round2(ratio)}x your average day across this window.`,
        amount: -point.outflow,
        date: point.date,
        metric: round2(ratio),
      },
    ];
  });
}

function detectNetNegativeStreaks(
  cashflow: CashflowPoint[],
  thresholds: CashflowAlertThresholds,
): CashflowAlert[] {
  const alerts: CashflowAlert[] = [];
  let runStart = -1;
  let runDrawdown = 0;

  const flush = (endIndex: number) => {
    const length = endIndex - runStart + 1;

    if (
      runStart >= 0 &&
      length >= thresholds.streakMinLength &&
      Math.abs(runDrawdown) >= thresholds.streakMinDrawdown
    ) {
      const startDate = cashflow[runStart].date;
      const endDate = cashflow[endIndex].date;
      const severity: CashflowAlertSeverity =
        Math.abs(runDrawdown) >= thresholds.streakMinDrawdown * 3 ? "critical" : "warning";

      alerts.push({
        id: `net_negative_streak:${startDate}`,
        type: "net_negative_streak",
        severity,
        title: `${length} straight days of negative cash flow`,
        detail: `Net drawdown of ${round2(Math.abs(runDrawdown))} from ${startDate} to ${endDate}.`,
        amount: round2(runDrawdown),
        date: startDate,
        endDate,
        metric: length,
      });
    }

    runStart = -1;
    runDrawdown = 0;
  };

  cashflow.forEach((point, index) => {
    if (point.net < 0) {
      if (runStart === -1) {
        runStart = index;
        runDrawdown = 0;
      }
      runDrawdown += point.net;
    } else if (runStart !== -1) {
      flush(index - 1);
    }
  });

  if (runStart !== -1) {
    flush(cashflow.length - 1);
  }

  return alerts;
}

function detectNegativeWindow(
  cashflow: CashflowPoint[],
  thresholds: CashflowAlertThresholds,
): CashflowAlert[] {
  if (cashflow.length === 0) {
    return [];
  }

  const totalNet = cashflow.reduce((total, point) => total + point.net, 0);

  if (totalNet > -thresholds.negativeCashflowMinNet) {
    return [];
  }

  const totalInflow = cashflow.reduce((total, point) => total + point.inflow, 0);
  const totalOutflow = cashflow.reduce((total, point) => total + point.outflow, 0);
  const severity: CashflowAlertSeverity =
    Math.abs(totalNet) >= thresholds.negativeCashflowMinNet * 3 ? "critical" : "warning";

  return [
    {
      id: "negative_cashflow:window",
      type: "negative_cashflow",
      severity,
      title: "Spending outpaced income this period",
      detail: `Outflow of ${round2(totalOutflow)} against inflow of ${round2(totalInflow)} left a net of ${round2(totalNet)}.`,
      amount: round2(totalNet),
      date: cashflow[0]?.date ?? "",
      endDate: cashflow[cashflow.length - 1]?.date,
      metric: round2(totalNet),
    },
  ];
}

export function detectCashflowAnomalies(
  input: DetectCashflowAnomaliesInput,
): CashflowAlertsResult {
  const thresholds: CashflowAlertThresholds = {
    ...DEFAULT_CASHFLOW_ALERT_THRESHOLDS,
    ...input.thresholds,
  };
  const transactions = input.transactions ?? [];
  const cashflow = [...input.cashflow].sort((left, right) =>
    left.date.localeCompare(right.date),
  );

  const largeTransactions = detectLargeTransactions(transactions, thresholds);
  const explainedDates = new Set(largeTransactions.map((alert) => alert.date));

  const alerts = [
    ...largeTransactions,
    ...detectOutflowSpikes(cashflow, thresholds, explainedDates),
    ...detectNetNegativeStreaks(cashflow, thresholds),
    ...detectNegativeWindow(cashflow, thresholds),
  ].sort((left, right) => {
    const bySeverity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];

    if (bySeverity !== 0) {
      return bySeverity;
    }

    const byAmount = Math.abs(right.amount) - Math.abs(left.amount);

    if (byAmount !== 0) {
      return byAmount;
    }

    return left.id.localeCompare(right.id);
  });

  const capped = alerts.slice(0, thresholds.maxAlerts);

  return {
    alerts: capped,
    summary: {
      total: capped.length,
      critical: capped.filter((alert) => alert.severity === "critical").length,
      warning: capped.filter((alert) => alert.severity === "warning").length,
      info: capped.filter((alert) => alert.severity === "info").length,
      windowFrom: cashflow[0]?.date ?? null,
      windowTo: cashflow[cashflow.length - 1]?.date ?? null,
    },
  };
}
