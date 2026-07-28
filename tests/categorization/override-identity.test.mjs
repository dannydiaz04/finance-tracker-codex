import assert from "node:assert/strict";
import test from "node:test";

import { buildOverrideIdentity } from "../../lib/categorization/override-identity.ts";

test("override identity is deterministic for retry-safe rule and suggestion ids", () => {
  assert.equal(
    buildOverrideIdentity({
      userId: "user-1",
      transactionId: "txn-1",
      categoryId: "groceries",
    }),
    "ab129f1dd46e93a1ffe09c0f",
  );
});

test("override identity changes when any stable input changes", () => {
  const original = buildOverrideIdentity({
    userId: "user-1",
    transactionId: "txn-1",
    categoryId: "groceries",
  });

  const variants = [
    { userId: "user-2", transactionId: "txn-1", categoryId: "groceries" },
    { userId: "user-1", transactionId: "txn-2", categoryId: "groceries" },
    { userId: "user-1", transactionId: "txn-1", categoryId: "dining" },
  ].map((input) => buildOverrideIdentity(input));

  assert.equal(original.length, 24);
  assert.match(original, /^[0-9a-f]{24}$/);
  assert.ok(variants.every((identity) => identity !== original));
});
