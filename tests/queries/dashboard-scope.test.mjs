import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTransactionQueryParams,
  normalizeTransactionFilters,
  scopeToTransactionFilters,
} from "../../lib/bigquery/params.ts";
import {
  buildTimeFilterQueryParams,
  copyTimeFilterParams,
  normalizeTimeFilter,
  timeFilterToSearchString,
} from "../../lib/time-filter.ts";

test("normalizes excludePlaid from dashboard and transaction search params", () => {
  const monthlyFilter = normalizeTimeFilter({
    month: "2026-04",
    excludePlaid: "true",
  });

  assert.deepEqual(monthlyFilter, {
    from: "2026-04-01",
    to: "2026-04-30",
    month: "2026-04",
    preset: "custom",
    excludePlaid: true,
  });
  assert.equal(
    normalizeTimeFilter({ timePreset: "last90", excludePlaid: "1" })
      .excludePlaid,
    true,
  );
  assert.equal(normalizeTimeFilter({ excludePlaid: "false" }).excludePlaid, false);
  assert.equal(normalizeTransactionFilters({ excludePlaid: "1" }).excludePlaid, true);
});

test("propagates excludePlaid through dashboard scope and BigQuery params", () => {
  const filter = normalizeTimeFilter({
    from: "2026-01-01",
    to: "2026-01-31",
    excludePlaid: "true",
  });
  const transactionScope = scopeToTransactionFilters(filter);

  assert.deepEqual(buildTimeFilterQueryParams(filter), {
    from: "2026-01-01",
    to: "2026-01-31",
    excludePlaid: true,
  });
  assert.deepEqual(transactionScope, {
    from: "2026-01-01",
    to: "2026-01-31",
    excludePlaid: true,
  });
  assert.equal(buildTransactionQueryParams(transactionScope).excludePlaid, true);
});

test("keeps excludePlaid when dashboard links copy scoped query params", () => {
  const source = new URLSearchParams(
    "from=2026-01-01&to=2026-01-31&excludePlaid=true&query=coffee",
  );
  const copied = copyTimeFilterParams(source);
  const serialized = timeFilterToSearchString({
    preset: "custom",
    from: "2026-01-01",
    to: "2026-01-31",
    excludePlaid: true,
  });

  assert.equal(copied.get("from"), "2026-01-01");
  assert.equal(copied.get("to"), "2026-01-31");
  assert.equal(copied.get("excludePlaid"), "true");
  assert.equal(copied.get("query"), null);
  assert.equal(new URLSearchParams(serialized).get("excludePlaid"), "true");
});
