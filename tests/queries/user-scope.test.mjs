import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transactionUserScopePredicate includes owned rows and anonymous CSV rows only when Plaid is excluded", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
  assert.equal(
    transactionUserScopePredicate("t"),
    "(t.user_id = @userId OR (@excludePlaid AND t.user_id IS NULL AND t.source_name = 'csv'))",
  );
});

test("accountUserScopePredicate preserves authenticated and CSV-only account visibility", () => {
  assert.equal(
    accountUserScopePredicate(),
    "(user_id = @userId OR (user_id IS NULL AND institution = 'csv'))",
  );
  assert.equal(
    accountUserScopePredicate("a"),
    "(a.user_id = @userId OR (a.user_id IS NULL AND a.institution = 'csv'))",
  );
});

test("anonymousCsvDedupePredicate keeps one anonymous CSV row per canonical group", () => {
  assert.equal(
    anonymousCsvDedupePredicate(),
    "(user_id IS NOT NULL OR source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY canonical_group_id ORDER BY transaction_id) = 1)",
  );
  assert.equal(
    anonymousCsvDedupePredicate("tx"),
    "(tx.user_id IS NOT NULL OR tx.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY tx.canonical_group_id ORDER BY tx.transaction_id) = 1)",
  );
});

test("plaidCanonicalDedupePredicate collapses repeated Plaid rows without merging distinct amounts or users", () => {
  assert.equal(
    plaidCanonicalDedupePredicate(),
    "(source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY user_id, source_name, canonical_group_id, signed_amount ORDER BY pending, transaction_id) = 1)",
  );
  assert.equal(
    plaidCanonicalDedupePredicate("t"),
    "(t.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY t.user_id, t.source_name, t.canonical_group_id, t.signed_amount ORDER BY t.pending, t.transaction_id) = 1)",
  );
});
