import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transaction scope only admits anonymous CSV rows in CSV-only mode", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
});

test("transaction scope applies table aliases to every column reference", () => {
  assert.equal(
    transactionUserScopePredicate("current_txn"),
    "(current_txn.user_id = @userId OR (@excludePlaid AND current_txn.user_id IS NULL AND current_txn.source_name = 'csv'))",
  );
});

test("account scope keeps CSV account rows visible for signed-in users", () => {
  assert.equal(
    accountUserScopePredicate("account_balances"),
    "(account_balances.user_id = @userId OR (account_balances.user_id IS NULL AND account_balances.institution = 'csv'))",
  );
});

test("anonymous CSV dedupe collapses repeated imports by canonical group", () => {
  assert.equal(
    anonymousCsvDedupePredicate("current_txn"),
    "(current_txn.user_id IS NOT NULL OR current_txn.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY current_txn.canonical_group_id ORDER BY current_txn.transaction_id) = 1)",
  );
});

test("Plaid canonical dedupe keeps one posted/pending row per canonical amount", () => {
  assert.equal(
    plaidCanonicalDedupePredicate("current_txn"),
    "(current_txn.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY current_txn.user_id, current_txn.source_name, current_txn.canonical_group_id, current_txn.signed_amount ORDER BY current_txn.pending, current_txn.transaction_id) = 1)",
  );
});
