import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transactionUserScopePredicate includes authenticated rows and anonymous CSV fallback only when Plaid is excluded", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );

  assert.equal(
    transactionUserScopePredicate("current_txn"),
    "(current_txn.user_id = @userId OR (@excludePlaid AND current_txn.user_id IS NULL AND current_txn.source_name = 'csv'))",
  );
});

test("accountUserScopePredicate includes anonymous CSV accounts without exposing anonymous Plaid accounts", () => {
  assert.equal(
    accountUserScopePredicate(),
    "(user_id = @userId OR (user_id IS NULL AND institution = 'csv'))",
  );

  assert.equal(
    accountUserScopePredicate("acct"),
    "(acct.user_id = @userId OR (acct.user_id IS NULL AND acct.institution = 'csv'))",
  );
});

test("anonymousCsvDedupePredicate keeps one anonymous CSV row per canonical group", () => {
  assert.equal(
    anonymousCsvDedupePredicate(),
    "(user_id IS NOT NULL OR source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY canonical_group_id ORDER BY transaction_id) = 1)",
  );

  assert.equal(
    anonymousCsvDedupePredicate("current_txn"),
    "(current_txn.user_id IS NOT NULL OR current_txn.source_name != 'csv' OR ROW_NUMBER() OVER (PARTITION BY current_txn.canonical_group_id ORDER BY current_txn.transaction_id) = 1)",
  );
});

test("plaidCanonicalDedupePredicate keeps one Plaid row per user, canonical group, and signed amount", () => {
  assert.equal(
    plaidCanonicalDedupePredicate(),
    "(source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY user_id, source_name, canonical_group_id, signed_amount ORDER BY pending, transaction_id) = 1)",
  );

  assert.equal(
    plaidCanonicalDedupePredicate("current_txn"),
    "(current_txn.source_name != 'plaid' OR ROW_NUMBER() OVER (PARTITION BY current_txn.user_id, current_txn.source_name, current_txn.canonical_group_id, current_txn.signed_amount ORDER BY current_txn.pending, current_txn.transaction_id) = 1)",
  );
});
