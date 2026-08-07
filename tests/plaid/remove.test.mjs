import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlaidItemRemover,
  removePlaidItemAtPlaid,
} from "../../lib/plaid/remove.ts";

function buildPlaidItem(overrides = {}) {
  return {
    userId: "user-123",
    itemId: "item-abc",
    accessToken: "access-secret",
    institutionId: "ins_1",
    institutionName: "Acme Bank",
    cursor: null,
    status: "active",
    error: null,
    lastSyncedAt: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function normalizeSql(query) {
  return query.replace(/\s+/g, " ").trim();
}

test("complete Plaid item removal purges warehouse rows scoped to user and item before deleting the record", async () => {
  const calls = [];
  const queries = [];
  const client = {
    itemRemove: async (request) => {
      calls.push(["plaid", request]);
    },
  };

  const remover = createPlaidItemRemover({
    getBigQueryProjectId: () => "finance-prod",
    runBigQueryQuery: async (query, params) => {
      queries.push({ query: normalizeSql(query), params });
      calls.push(["query", params]);
      return [];
    },
    deletePlaidItem: async (itemId) => {
      calls.push(["delete", itemId]);
      return true;
    },
  });

  const result = await remover.removePlaidItemCompletely({
    client,
    item: buildPlaidItem(),
  });

  assert.deepEqual(result, {
    removedAtPlaid: true,
    purgedWarehouse: true,
    deletedRecord: true,
  });
  assert.deepEqual(calls.map(([kind]) => kind), [
    "plaid",
    "query",
    "query",
    "query",
    "delete",
  ]);
  assert.deepEqual(calls[0][1], { access_token: "access-secret" });
  assert.equal(calls.at(-1)[1], "item-abc");

  assert.equal(queries.length, 3);
  assert.match(
    queries[0].query,
    /DELETE FROM `finance-prod\.ops_finance\.account_metadata`/,
  );
  assert.match(
    queries[0].query,
    /account_id IN \( SELECT DISTINCT source_account_id FROM `finance-prod\.raw_finance\.transaction_events`/,
  );
  assert.match(
    queries[1].query,
    /DELETE FROM `finance-prod\.raw_finance\.transaction_events`/,
  );
  assert.match(
    queries[2].query,
    /DELETE FROM `finance-prod\.raw_finance\.import_batches`/,
  );

  for (const { query, params } of queries) {
    assert.deepEqual(params, { user_id: "user-123", item_id: "item-abc" });
    assert.match(query, /WHERE user_id = @user_id/);
  }
  assert.match(
    queries[0].query,
    /import_batch_id LIKE CONCAT\('plaid-', @item_id, '-%'\)/,
  );
  assert.match(
    queries[1].query,
    /import_batch_id LIKE CONCAT\('plaid-', @item_id, '-%'\)/,
  );
  assert.match(
    queries[2].query,
    /file_name = CONCAT\('plaid-sync:', @item_id\)/,
  );
});

test("complete Plaid item removal can skip warehouse purge while still removing Plaid and local records", async () => {
  const calls = [];
  const client = {
    itemRemove: async (request) => {
      calls.push(["plaid", request]);
    },
  };
  const remover = createPlaidItemRemover({
    runBigQueryQuery: async () => {
      calls.push(["query"]);
      throw new Error("warehouse should not be touched");
    },
    deletePlaidItem: async (itemId) => {
      calls.push(["delete", itemId]);
      return true;
    },
  });

  const result = await remover.removePlaidItemCompletely({
    client,
    item: buildPlaidItem(),
    purgeWarehouse: false,
  });

  assert.deepEqual(result, {
    removedAtPlaid: true,
    purgedWarehouse: false,
    deletedRecord: true,
  });
  assert.deepEqual(calls.map(([kind]) => kind), ["plaid", "delete"]);
});

test("Plaid item removal failure returns false and logs only the safe Plaid message", async () => {
  const logged = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    logged.push(args);
  };

  try {
    const result = await removePlaidItemAtPlaid(
      {
        itemRemove: async () => {
          throw {
            response: {
              data: {
                error_code: "ITEM_NOT_FOUND",
                error_message: "the item is already gone",
              },
            },
            config: {
              data: { access_token: "access-secret" },
              headers: { "PLAID-SECRET": "plaid-secret" },
            },
          };
        },
      },
      "access-secret",
    );

    assert.equal(result, false);
  } finally {
    console.error = originalConsoleError;
  }

  assert.equal(logged.length, 1);
  assert.equal(logged[0][0], "[plaid:remove] item/remove failed");
  assert.deepEqual(logged[0][1], {
    message: "ITEM_NOT_FOUND: the item is already gone",
  });
  assert.doesNotMatch(JSON.stringify(logged), /access-secret|plaid-secret/);
});
