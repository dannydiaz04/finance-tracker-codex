import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transaction scope includes current user rows and anonymous CSV rows only when Plaid is excluded", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
  assert.equal(
    transactionUserScopePredicate("t"),
    "(t.user_id = @userId OR (@excludePlaid AND t.user_id IS NULL AND t.source_name = 'csv'))",
  );
});

test("account scope permits current user accounts plus anonymous CSV account metadata", () => {
  assert.equal(
    accountUserScopePredicate(),
    "(user_id = @userId OR (user_id IS NULL AND institution = 'csv'))",
  );
  assert.equal(
    accountUserScopePredicate("a"),
    "(a.user_id = @userId OR (a.user_id IS NULL AND a.institution = 'csv'))",
  );
});

test("anonymous CSV dedupe keeps one row per canonical group while preserving user-owned and non-CSV rows", () => {
  assert.equal(
    anonymousCsvDedupePredicate(),
    "(user_id IS NOT NULL OR source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY canonical_group_id ORDER BY transaction_id) = 1)",
  );
  assert.equal(
    anonymousCsvDedupePredicate("f"),
    "(f.user_id IS NOT NULL OR f.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY f.canonical_group_id ORDER BY f.transaction_id) = 1)",
  );
});

test("Plaid canonical dedupe partitions by user, source, canonical group, and amount", () => {
  assert.equal(
    plaidCanonicalDedupePredicate(),
    "(source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY user_id, source_name, canonical_group_id, signed_amount ORDER BY pending, transaction_id) = 1)",
  );
  assert.equal(
    plaidCanonicalDedupePredicate("txn"),
    "(txn.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY txn.user_id, txn.source_name, txn.canonical_group_id, txn.signed_amount ORDER BY txn.pending, txn.transaction_id) = 1)",
  );
});
