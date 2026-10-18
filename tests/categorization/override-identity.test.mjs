import assert from "node:assert/strict";
import test from "node:test";

import { buildOverrideIdentity } from "../../lib/categorization/override-identity.ts";

test("buildOverrideIdentity is stable and route-safe for retry ids", () => {
  const identity = buildOverrideIdentity({
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  });

  assert.equal(
    identity,
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-1",
      categoryId: "groceries",
    }),
  );
  assert.match(identity, /^[0-9a-f]{24}$/);
});

test("buildOverrideIdentity changes when the override target changes", () => {
  const original = buildOverrideIdentity({
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  });

  assert.notEqual(
    original,
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-1",
      categoryId: "dining",
    }),
  );
  assert.notEqual(
    original,
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-2",
      categoryId: "groceries",
    }),
  );
});
