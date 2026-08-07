import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transactionUserScopePredicate includes user rows and anonymous CSV only when Plaid is excluded", () => {
  assert.equal(
    transactionUserScopePredicate("txn"),
    "(txn.user_id = @userId OR (@excludePlaid AND txn.user_id IS NULL AND txn.source_name = 'csv'))",
  );
});

test("accountUserScopePredicate keeps anonymous CSV account metadata visible", () => {
  assert.equal(
    accountUserScopePredicate("acct"),
    "(acct.user_id = @userId OR (acct.user_id IS NULL AND acct.institution = 'csv'))",
  );
});

test("anonymousCsvDedupePredicate keeps one anonymous CSV row per canonical group", () => {
  assert.equal(
    anonymousCsvDedupePredicate("txn"),
    "(txn.user_id IS NOT NULL OR txn.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY txn.canonical_group_id ORDER BY txn.transaction_id) = 1)",
  );
});

test("plaidCanonicalDedupePredicate removes duplicate Plaid current rows by user, group, and signed amount", () => {
  assert.equal(
    plaidCanonicalDedupePredicate("txn"),
    "(txn.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY txn.user_id, txn.source_name, txn.canonical_group_id, txn.signed_amount ORDER BY txn.pending, txn.transaction_id) = 1)",
  );
});

test("plaidCanonicalDedupePredicate supports unaliased query fragments", () => {
  assert.equal(
    plaidCanonicalDedupePredicate(),
    "(source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY user_id, source_name, canonical_group_id, signed_amount ORDER BY pending, transaction_id) = 1)",
  );
});
