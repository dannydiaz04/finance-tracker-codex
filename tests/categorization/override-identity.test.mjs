import assert from "node:assert/strict";
import test from "node:test";

import { buildOverrideIdentity } from "../../lib/categorization/override-identity.ts";

test("override identity is stable for retrying the same user transaction category", () => {
  const input = {
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  };

  assert.equal(buildOverrideIdentity(input), buildOverrideIdentity({ ...input }));
  assert.match(buildOverrideIdentity(input), /^[a-f0-9]{24}$/);
});

test("override identity changes across user, transaction, and category boundaries", () => {
  const base = {
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  };
  const identity = buildOverrideIdentity(base);

  assert.notEqual(buildOverrideIdentity({ ...base, userId: "user-2" }), identity);
  assert.notEqual(buildOverrideIdentity({ ...base, transactionId: "txn-2" }), identity);
  assert.notEqual(buildOverrideIdentity({ ...base, categoryId: "dining" }), identity);
});
