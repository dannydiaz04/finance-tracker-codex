import assert from "node:assert/strict";
import test from "node:test";

import {
  accountUserScopePredicate,
  anonymousCsvDedupePredicate,
  plaidCanonicalDedupePredicate,
  transactionUserScopePredicate,
} from "../../lib/queries/user-scope.ts";

function assertBalancedParentheses(sql) {
  let depth = 0;

  for (const char of sql) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    }

    assert.ok(depth >= 0, `predicate closed too early: ${sql}`);
  }

  assert.equal(depth, 0, `predicate has unmatched parentheses: ${sql}`);
}

test("transaction scope keeps authenticated rows and anonymous CSV rows for CSV-only mode", () => {
  const predicate = transactionUserScopePredicate();

  assert.equal(
    predicate,
    "(user_id = @userId OR (@excludePlaid AND user_id IS NULL AND source_name = 'csv'))",
  );
  assertBalancedParentheses(predicate);
});

test("account scope includes authenticated accounts and anonymous CSV account metadata", () => {
  const predicate = accountUserScopePredicate("a");

  assert.equal(
    predicate,
    "(a.user_id = @userId OR (a.user_id IS NULL AND a.institution = 'csv'))",
  );
  assertBalancedParentheses(predicate);
});

test("anonymous CSV dedupe collapses repeated imports by canonical group", () => {
  const predicate = anonymousCsvDedupePredicate("t");

  assert.match(predicate, /t\.user_id IS NOT NULL/);
  assert.match(predicate, /t\.source_name != 'csv'/);
  assert.match(predicate, /PARTITION BY t\.canonical_group_id/);
  assert.match(predicate, /ORDER BY t\.transaction_id\) = 1/);
  assertBalancedParentheses(predicate);
});

test("Plaid canonical dedupe deterministically picks one pending or posted row", () => {
  const predicate = plaidCanonicalDedupePredicate("txn");

  assert.match(predicate, /txn\.source_name != 'plaid'/);
  assert.match(
    predicate,
    /PARTITION BY txn\.user_id, txn\.source_name, txn\.canonical_group_id, txn\.signed_amount/,
  );
  assert.match(predicate, /ORDER BY txn\.pending, txn\.transaction_id\) = 1/);
  assertBalancedParentheses(predicate);
});
