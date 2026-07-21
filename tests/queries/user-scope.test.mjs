import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transaction scope includes user rows and anonymous CSV rows only for Plaid exclusion", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
  assert.equal(
    transactionUserScopePredicate("txn"),
    "(txn.user_id = @userId OR (@excludePlaid AND txn.user_id IS NULL AND txn.source_name = 'csv'))",
  );
});

test("account scope keeps user accounts and anonymous CSV account metadata", () => {
  assert.equal(
    accountUserScopePredicate("acct"),
    "(acct.user_id = @userId OR (acct.user_id IS NULL AND acct.institution = 'csv'))",
  );
});

test("anonymous CSV dedupe keeps one row per canonical group only for unowned CSV rows", () => {
  const predicate = anonymousCsvDedupePredicate("txn");

  assert.match(predicate, /^[(]txn\.user_id IS NOT NULL OR txn\.source_name != 'csv'/);
  assert.match(
    predicate,
    /ROW_NUMBER\(\) OVER \(PARTITION BY txn\.canonical_group_id ORDER BY txn\.transaction_id\) = 1[)]$/,
  );
});

test("Plaid canonical dedupe partitions by user, source, canonical group, and signed amount", () => {
  assert.equal(
    plaidCanonicalDedupePredicate(),
    "(source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY user_id, source_name, canonical_group_id, signed_amount ORDER BY pending, transaction_id) = 1)",
  );
  assert.equal(
    plaidCanonicalDedupePredicate("txn"),
    "(txn.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY txn.user_id, txn.source_name, txn.canonical_group_id, txn.signed_amount ORDER BY txn.pending, txn.transaction_id) = 1)",
  );
});
