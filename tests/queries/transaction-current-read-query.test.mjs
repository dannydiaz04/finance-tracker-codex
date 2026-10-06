import assert from "node:assert/strict";
import test from "node:test";

import { buildTransactionCurrentReadQuery } from "../../lib/queries/transaction-current-read-query.ts";

function compact(sql) {
  return sql.replace(/\s+/g, " ").trim();
}

test("manual override overlay reads only the current user's latest override", () => {
  const sql = compact(buildTransactionCurrentReadQuery("finance-prod"));

  assert.match(
    sql,
    /FROM `finance-prod\.ops_finance\.manual_overrides` WHERE user_id = @userId QUALIFY ROW_NUMBER\(\) OVER \( PARTITION BY transaction_id ORDER BY updated_at DESC, category_id DESC \) = 1/,
  );
  assert.match(
    sql,
    /LEFT JOIN latest_overrides ON latest_overrides\.transaction_id = scoped_transactions\.transaction_id/,
  );
});

test("manual override overlay replaces category fields from effective dimensions", () => {
  const sql = compact(buildTransactionCurrentReadQuery("finance-prod"));

  assert.match(
    sql,
    /COALESCE\( latest_overrides\.category_id, scoped_transactions\.derived_category_id \) AS resolved_category_id/,
  );
  assert.match(
    sql,
    /resolved_transactions\.resolved_category_id AS derived_category_id/,
  );
  assert.match(
    sql,
    /COALESCE\( effective_user_category\.label, effective_seed_category\.label, resolved_transactions\.category_label \) AS category_label/,
  );
  assert.match(
    sql,
    /COALESCE\( effective_user_category\.category_l2, effective_seed_category\.category_l2, resolved_transactions\.subcategory_id \) AS subcategory_id/,
  );
  assert.match(
    sql,
    /COALESCE\( effective_user_category\.category_l1, effective_seed_category\.category_l1, resolved_transactions\.category_group \) AS category_group/,
  );
});

test("manual override overlay marks source and confidence only when an override exists", () => {
  const sql = compact(buildTransactionCurrentReadQuery("finance-prod"));

  assert.match(
    sql,
    /IF\( resolved_transactions\.override_category_id IS NOT NULL, CAST\(1 AS FLOAT64\), resolved_transactions\.confidence_score \) AS confidence_score/,
  );
  assert.match(
    sql,
    /IF\( resolved_transactions\.override_category_id IS NOT NULL, "manual_override", resolved_transactions\.classification_source \) AS classification_source/,
  );
});

test("manual override overlay replaces category_group instead of emitting a duplicate column", () => {
  const sql = compact(buildTransactionCurrentReadQuery("finance-prod"));

  assert.match(sql, /REPLACE \( .* AS category_group, IF\(/);
  assert.doesNotMatch(
    sql,
    /\) REPLACE \( .* AS classification_source \), COALESCE\( .* \) AS category_group/s,
  );
});
