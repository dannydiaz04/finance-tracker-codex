import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_CASHFLOW_ALERT_THRESHOLDS,
  detectCashflowAnomalies,
} from "../../lib/alerts/cashflow-anomalies.ts";

function expense(id, amount, { date = "2026-03-01", merchant = "Shop" } = {}) {
  return {
    transactionId: id,
    postedAt: date,
    direction: "outflow",
    transactionClass: "expense",
    signedAmount: -Math.abs(amount),
    merchantRaw: merchant,
    merchantNorm: merchant.toLowerCase(),
    categoryLabel: "Dining",
  };
}

function point(date, inflow, outflow) {
  return { date, inflow, outflow, net: inflow - outflow };
}

test("flags a single charge that dwarfs the median spend", () => {
  const transactions = [
    expense("a", 40),
    expense("b", 45),
    expense("c", 50),
    expense("d", 55),
    expense("e", 3000, { merchant: "Vista Property" }),
  ];

  const { alerts } = detectCashflowAnomalies({ cashflow: [], transactions });
  const large = alerts.filter((alert) => alert.type === "large_transaction");

  assert.equal(large.length, 1);
  assert.equal(large[0].transactionId, "e");
  assert.equal(large[0].severity, "critical");
  assert.ok(large[0].amount < 0, "amount should be signed negative for outflow");
  assert.match(large[0].title, /Vista Property/);
});

test("does not flag uniform spend as a large transaction", () => {
  const transactions = [
    expense("a", 100),
    expense("b", 105),
    expense("c", 110),
    expense("d", 95),
  ];

  const { alerts } = detectCashflowAnomalies({ cashflow: [], transactions });

  assert.equal(
    alerts.filter((alert) => alert.type === "large_transaction").length,
    0,
  );
});

test("ignores transfers and credit-card payments when sizing spend", () => {
  const transactions = [
    expense("a", 40),
    expense("b", 45),
    expense("c", 50),
    {
      transactionId: "transfer",
      postedAt: "2026-03-02",
      direction: "outflow",
      transactionClass: "transfer",
      signedAmount: -5000,
      merchantRaw: "Schwab Transfer",
      merchantNorm: "schwab transfer",
      categoryLabel: "Transfers",
    },
  ];

  const { alerts } = detectCashflowAnomalies({ cashflow: [], transactions });

  assert.equal(
    alerts.some((alert) => alert.transactionId === "transfer"),
    false,
  );
});

test("detects a sustained net-negative streak", () => {
  const cashflow = [
    point("2026-03-01", 0, 800),
    point("2026-03-02", 0, 700),
    point("2026-03-03", 0, 600),
    point("2026-03-04", 5000, 0),
  ];

  const { alerts } = detectCashflowAnomalies({ cashflow });
  const streaks = alerts.filter((alert) => alert.type === "net_negative_streak");

  assert.equal(streaks.length, 1);
  assert.equal(streaks[0].date, "2026-03-01");
  assert.equal(streaks[0].endDate, "2026-03-03");
  assert.equal(streaks[0].metric, 3);
});

test("a positive day breaks the streak before the minimum length", () => {
  const cashflow = [
    point("2026-03-01", 0, 800),
    point("2026-03-02", 5000, 0),
    point("2026-03-03", 0, 700),
    point("2026-03-04", 0, 600),
  ];

  const { alerts } = detectCashflowAnomalies({ cashflow });

  assert.equal(
    alerts.filter((alert) => alert.type === "net_negative_streak").length,
    0,
  );
});

test("flags negative cash flow across the window", () => {
  const cashflow = [
    point("2026-03-01", 100, 3000),
    point("2026-03-02", 200, 400),
  ];

  const { alerts } = detectCashflowAnomalies({ cashflow });
  const windowAlerts = alerts.filter(
    (alert) => alert.type === "negative_cashflow",
  );

  assert.equal(windowAlerts.length, 1);
  assert.ok(windowAlerts[0].amount < 0);
  assert.equal(windowAlerts[0].date, "2026-03-01");
  assert.equal(windowAlerts[0].endDate, "2026-03-02");
});

test("suppresses an outflow-spike day already explained by a large charge", () => {
  const sharedDate = "2026-03-10";
  const transactions = [
    expense("a", 40, { date: "2026-03-01" }),
    expense("b", 45, { date: "2026-03-02" }),
    expense("c", 50, { date: "2026-03-03" }),
    expense("spike", 4000, { date: sharedDate, merchant: "Rent" }),
  ];
  const cashflow = [
    point("2026-03-01", 0, 40),
    point("2026-03-02", 0, 45),
    point("2026-03-03", 0, 50),
    point(sharedDate, 0, 4000),
  ];

  const { alerts } = detectCashflowAnomalies({ cashflow, transactions });

  assert.equal(
    alerts.some(
      (alert) => alert.type === "outflow_spike" && alert.date === sharedDate,
    ),
    false,
    "spike day should be represented by the large_transaction alert, not duplicated",
  );
  assert.equal(
    alerts.some(
      (alert) => alert.type === "large_transaction" && alert.date === sharedDate,
    ),
    true,
  );
});

test("emits a standalone outflow-spike when no single charge explains it", () => {
  const cashflow = [
    point("2026-03-01", 0, 100),
    point("2026-03-02", 0, 120),
    point("2026-03-03", 0, 110),
    point("2026-03-10", 0, 1200),
  ];

  const { alerts } = detectCashflowAnomalies({ cashflow });
  const spikes = alerts.filter((alert) => alert.type === "outflow_spike");

  assert.equal(spikes.length, 1);
  assert.equal(spikes[0].date, "2026-03-10");
});

test("returns no alerts and a null window for empty input", () => {
  const { alerts, summary } = detectCashflowAnomalies({ cashflow: [] });

  assert.equal(alerts.length, 0);
  assert.equal(summary.total, 0);
  assert.equal(summary.windowFrom, null);
  assert.equal(summary.windowTo, null);
});

test("respects threshold overrides", () => {
  const transactions = [
    expense("a", 100),
    expense("b", 105),
    expense("c", 110),
    expense("d", 260),
  ];

  const lenient = detectCashflowAnomalies({ cashflow: [], transactions });
  assert.equal(
    lenient.alerts.filter((alert) => alert.type === "large_transaction").length,
    0,
    "260 is ~2.4x median, below the default 4x ratio",
  );

  const strict = detectCashflowAnomalies({
    cashflow: [],
    transactions,
    thresholds: { largeTxnRatio: 2, largeTxnAbsoluteFloor: 250 },
  });
  assert.equal(
    strict.alerts.filter((alert) => alert.type === "large_transaction").length,
    1,
  );
});

test("summary counts severities and orders critical first", () => {
  const transactions = [
    expense("a", 40),
    expense("b", 45),
    expense("c", 50),
    expense("huge", 5000, { merchant: "Rent" }),
  ];
  const cashflow = [
    point("2026-03-01", 100, 4000),
    point("2026-03-02", 100, 600),
    point("2026-03-03", 100, 700),
  ];

  const { alerts, summary } = detectCashflowAnomalies({ cashflow, transactions });

  assert.ok(summary.total >= 2);
  assert.equal(
    summary.critical + summary.warning + summary.info,
    summary.total,
  );
  assert.equal(summary.windowFrom, "2026-03-01");
  assert.equal(summary.windowTo, "2026-03-03");

  for (let index = 1; index < alerts.length; index += 1) {
    const rank = { critical: 0, warning: 1, info: 2 };
    assert.ok(
      rank[alerts[index - 1].severity] <= rank[alerts[index].severity],
      "alerts must be ordered by descending severity",
    );
  }
});

test("default thresholds are sane", () => {
  assert.ok(DEFAULT_CASHFLOW_ALERT_THRESHOLDS.largeTxnRatio > 1);
  assert.ok(DEFAULT_CASHFLOW_ALERT_THRESHOLDS.maxAlerts > 0);
});
