import assert from "node:assert/strict";
import test from "node:test";

import { buildOverrideIdentity } from "../../lib/categorization/override-identity.ts";

test("buildOverrideIdentity is deterministic for the same user, transaction, and category", () => {
  const input = {
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  };

  assert.equal(buildOverrideIdentity(input), buildOverrideIdentity(input));
});

test("buildOverrideIdentity changes when the transaction or category changes", () => {
  const base = buildOverrideIdentity({
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  });

  assert.notEqual(
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-2",
      categoryId: "groceries",
    }),
    base,
  );
  assert.notEqual(
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-1",
      categoryId: "dining",
    }),
    base,
  );
});

test("buildOverrideIdentity returns the expected compact hex id", () => {
  assert.match(
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-1",
      categoryId: "groceries",
    }),
    /^[0-9a-f]{24}$/,
  );
});
