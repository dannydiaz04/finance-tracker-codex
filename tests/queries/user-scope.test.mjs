import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transaction scope includes user rows and anonymous CSV rows only when Plaid is excluded", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
  assert.equal(
    transactionUserScopePredicate("txn"),
    "(txn.user_id = @userId OR (@excludePlaid AND txn.user_id IS NULL AND txn.source_name = 'csv'))",
  );
});

test("account scope keeps user rows and legacy anonymous CSV account metadata", () => {
  assert.equal(
    accountUserScopePredicate(),
    "(user_id = @userId OR (user_id IS NULL AND institution = 'csv'))",
  );
  assert.equal(
    accountUserScopePredicate("acct"),
    "(acct.user_id = @userId OR (acct.user_id IS NULL AND acct.institution = 'csv'))",
  );
});

test("anonymous CSV dedupe partitions by canonical group to keep one legacy row", () => {
  assert.equal(
    anonymousCsvDedupePredicate(),
    "(user_id IS NOT NULL OR source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY canonical_group_id ORDER BY transaction_id) = 1)",
  );
  assert.equal(
    anonymousCsvDedupePredicate("fact"),
    "(fact.user_id IS NOT NULL OR fact.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY fact.canonical_group_id ORDER BY fact.transaction_id) = 1)",
  );
});

test("Plaid canonical dedupe isolates duplicates by user, source, group, and signed amount", () => {
  assert.equal(
    plaidCanonicalDedupePredicate(),
    "(source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY user_id, source_name, canonical_group_id, signed_amount ORDER BY pending, transaction_id) = 1)",
  );
  assert.equal(
    plaidCanonicalDedupePredicate("fact"),
    "(fact.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY fact.user_id, fact.source_name, fact.canonical_group_id, fact.signed_amount ORDER BY fact.pending, fact.transaction_id) = 1)",
  );
});
