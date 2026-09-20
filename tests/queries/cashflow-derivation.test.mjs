import assert from "node:assert/strict";
import test from "node:test";

import { deriveCashflowFromTransactions } from "../../lib/queries/finance-aggregates.ts";
import {
  buildTimeFilterQueryParams,
  copyTimeFilterParams,
  normalizeTimeFilter,
  timeFilterToSearchString,
} from "../../lib/time-filter.ts";

function transaction(id, postedAt, signedAmount, transactionClass = "expense") {
  return {
    transactionId: id,
    postedAt,
    signedAmount,
    transactionClass,
  };
}

test("derives daily cashflow from transactions for the Plaid-exclusion path", () => {
  const cashflow = deriveCashflowFromTransactions([
    transaction("paycheck", "2026-04-02", 3000, "income"),
    transaction("groceries", "2026-04-02", -125.5),
    transaction("coffee", "2026-04-01", -4.25),
    transaction("refund", "2026-04-01", 20, "refund"),
  ]);

  assert.deepEqual(cashflow, [
    {
      date: "2026-04-02",
      inflow: 3000,
      outflow: 125.5,
      net: 2874.5,
    },
    {
      date: "2026-04-01",
      inflow: 20,
      outflow: 4.25,
      net: 15.75,
    },
  ]);
});

test("excludes internal movements from derived cashflow totals", () => {
  const cashflow = deriveCashflowFromTransactions([
    transaction("rent", "2026-05-10", -1500),
    transaction("checking-to-savings", "2026-05-10", -700, "transfer"),
    transaction("card-payment", "2026-05-10", -400, "credit_payment"),
    transaction("paycheck", "2026-05-09", 3000, "income"),
  ]);

  assert.deepEqual(cashflow, [
    {
      date: "2026-05-10",
      inflow: 0,
      outflow: 1500,
      net: -1500,
    },
    {
      date: "2026-05-09",
      inflow: 3000,
      outflow: 0,
      net: 3000,
    },
  ]);
});

test("round-trips excludePlaid through dashboard time-filter helpers", () => {
  const filter = normalizeTimeFilter({
    month: "2026-06",
    excludePlaid: "1",
  });

  assert.deepEqual(filter, {
    from: "2026-06-01",
    to: "2026-06-30",
    month: "2026-06",
    preset: "custom",
    excludePlaid: true,
  });
  assert.deepEqual(buildTimeFilterQueryParams(filter), {
    from: "2026-06-01",
    to: "2026-06-30",
    excludePlaid: true,
  });
  assert.equal(
    timeFilterToSearchString(filter),
    "from=2026-06-01&to=2026-06-30&month=2026-06&timePreset=custom&excludePlaid=true",
  );

  const copied = copyTimeFilterParams(
    new URLSearchParams("from=2026-06-01&excludePlaid=true&unused=value"),
  );

  assert.equal(copied.toString(), "from=2026-06-01&excludePlaid=true");
});

test("keeps excludePlaid disabled unless explicitly requested", () => {
  assert.equal(
    normalizeTimeFilter({ excludePlaid: "false" }).excludePlaid,
    false,
  );
  assert.equal(normalizeTimeFilter({ excludePlaid: "0" }).excludePlaid, false);
  assert.equal(normalizeTimeFilter({}).excludePlaid, false);
  assert.equal(timeFilterToSearchString({ preset: "all" }), "");
});
