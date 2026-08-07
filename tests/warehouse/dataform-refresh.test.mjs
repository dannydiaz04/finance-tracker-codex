import assert from "node:assert/strict";
import test from "node:test";

import {
  refreshWarehouseMarts,
  summarizeWarehouseRefresh,
} from "../../lib/warehouse/dataform-refresh.ts";

function withEnv(overrides, callback) {
  const keys = ["PLAID_SYNC_REFRESH_WAREHOUSE"];
  const previousValues = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    delete process.env[key];
  }

  Object.assign(process.env, overrides);

  try {
    return callback();
  } finally {
    for (const key of keys) {
      const previousValue = previousValues.get(key);

      if (typeof previousValue === "undefined") {
        delete process.env[key];
      } else {
        process.env[key] = previousValue;
      }
    }
  }
}

test("summarizeWarehouseRefresh omits command output from successful API payloads", () => {
  assert.deepEqual(
    summarizeWarehouseRefresh({
      status: "ran",
      durationMs: 1234,
      stdout: "compiled warehouse output",
      stderr: "dataform warning",
    }),
    {
      status: "ran",
      durationMs: 1234,
      deduped: false,
    },
  );
});

test("summarizeWarehouseRefresh preserves error metadata without exposing stdout or stderr", () => {
  assert.deepEqual(
    summarizeWarehouseRefresh({
      status: "error",
      reason: "Dataform failed.",
      durationMs: 500,
      stdout: "sensitive stdout",
      stderr: "sensitive stderr",
      deduped: true,
    }),
    {
      status: "error",
      reason: "Dataform failed.",
      durationMs: 500,
      deduped: true,
    },
  );
});

test("refreshWarehouseMarts skips before BigQuery or Dataform work when disabled by environment", async () => {
  await withEnv({ PLAID_SYNC_REFRESH_WAREHOUSE: " off " }, async () => {
    assert.deepEqual(await refreshWarehouseMarts(), {
      status: "skipped",
      reason: "Warehouse refresh is disabled by PLAID_SYNC_REFRESH_WAREHOUSE.",
    });
  });
});
