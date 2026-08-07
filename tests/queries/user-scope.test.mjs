import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transaction scope includes anonymous CSV rows only when Plaid is excluded", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
});

test("transaction scope prefixes every column when used inside aliased SQL", () => {
  assert.equal(
    transactionUserScopePredicate("current_txn"),
    "(current_txn.user_id = @userId OR (@excludePlaid AND current_txn.user_id IS NULL AND current_txn.source_name = 'csv'))",
  );
});

test("account scope permits user-owned accounts and anonymous CSV account metadata", () => {
  assert.equal(
    accountUserScopePredicate("account"),
    "(account.user_id = @userId OR (account.user_id IS NULL AND account.institution = 'csv'))",
  );
});

test("anonymous CSV dedupe keeps only the first canonical CSV row", () => {
  assert.equal(
    anonymousCsvDedupePredicate(),
    "(user_id IS NOT NULL OR source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY canonical_group_id ORDER BY transaction_id) = 1)",
  );
});

test("anonymous CSV dedupe supports aliases for nested dashboard queries", () => {
  assert.equal(
    anonymousCsvDedupePredicate("current_txn"),
    "(current_txn.user_id IS NOT NULL OR current_txn.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY current_txn.canonical_group_id ORDER BY current_txn.transaction_id) = 1)",
  );
});

test("Plaid canonical dedupe partitions by user, source, canonical group, and amount", () => {
  assert.equal(
    plaidCanonicalDedupePredicate(),
    "(source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY user_id, source_name, canonical_group_id, signed_amount ORDER BY pending, transaction_id) = 1)",
  );
});

test("Plaid canonical dedupe prefers posted rows before transaction id within aliases", () => {
  assert.equal(
    plaidCanonicalDedupePredicate("current_txn"),
    "(current_txn.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY current_txn.user_id, current_txn.source_name, current_txn.canonical_group_id, current_txn.signed_amount ORDER BY current_txn.pending, current_txn.transaction_id) = 1)",
  );
});
