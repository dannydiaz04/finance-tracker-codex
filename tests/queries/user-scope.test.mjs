import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

test("transaction scope keeps anonymous CSV rows available only for CSV-only views", () => {
  assert.equal(
    transactionUserScopePredicate(),
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
  assert.equal(
    transactionUserScopePredicate("current_txn"),
    "(current_txn.user_id = @userId OR (@excludePlaid AND current_txn.user_id IS NULL AND current_txn.source_name = 'csv'))",
  );
});

test("account scope includes only owned accounts and anonymous CSV accounts", () => {
  assert.equal(
    accountUserScopePredicate(),
    "(user_id = @userId OR (user_id IS NULL AND institution = 'csv'))",
  );
  assert.equal(
    accountUserScopePredicate("account"),
    "(account.user_id = @userId OR (account.user_id IS NULL AND account.institution = 'csv'))",
  );
});

test("anonymous CSV dedupe keeps one canonical row without hiding owned imports", () => {
  const predicate = anonymousCsvDedupePredicate("txn");

  assert.match(predicate, /txn\.user_id IS NOT NULL/);
  assert.match(predicate, /txn\.source_name != 'csv'/);
  assert.match(predicate, /PARTITION BY txn\.canonical_group_id/);
  assert.match(predicate, /ORDER BY txn\.transaction_id/);
});

test("Plaid canonical dedupe ranks duplicates inside a user and amount bucket", () => {
  const predicate = plaidCanonicalDedupePredicate("txn");

  assert.match(predicate, /txn\.source_name != 'plaid'/);
  assert.match(
    predicate,
    /PARTITION BY txn\.user_id, txn\.source_name, txn\.canonical_group_id, txn\.signed_amount/,
  );
  assert.match(predicate, /ORDER BY txn\.pending, txn\.transaction_id/);
});
