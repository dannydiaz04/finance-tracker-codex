import assert from "node:assert/strict";
import test from "node:test";

import {
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transaction user scope admits selected-user rows and anonymous CSV backfill when Plaid is excluded", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
  assert.equal(
    transactionUserScopePredicate("t"),
    "(t.user_id = @userId OR (@excludePlaid AND t.user_id IS NULL AND t.source_name = 'csv'))",
  );
});

test("anonymous CSV dedupe keeps only one anonymous row per canonical group", () => {
  assert.equal(
    anonymousCsvDedupePredicate("tx"),
    "(tx.user_id IS NOT NULL OR tx.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY tx.canonical_group_id ORDER BY tx.transaction_id) = 1)",
  );
});

test("Plaid canonical dedupe partitions by user and amount so similar transactions do not collapse across users", () => {
  assert.equal(
    plaidCanonicalDedupePredicate(),
    "(source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY user_id, source_name, canonical_group_id, signed_amount ORDER BY pending, transaction_id) = 1)",
  );
  assert.equal(
    plaidCanonicalDedupePredicate("tx"),
    "(tx.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY tx.user_id, tx.source_name, tx.canonical_group_id, tx.signed_amount ORDER BY tx.pending, tx.transaction_id) = 1)",
  );
});
