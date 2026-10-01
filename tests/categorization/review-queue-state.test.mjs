import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBatchResolutions,
  buildInitialReviewDrafts,
  clearReviewErrors,
  describeBatchNotice,
  getBatchResultIds,
  removeReviewIds,
} from "../../lib/categorization/review-queue-state.ts";

const categories = [
  { id: "groceries" },
  { id: "dining" },
  { id: "utilities" },
];

test("batch review drafts start from each transaction's current category", () => {
  const drafts = buildInitialReviewDrafts(
    [
      { transactionId: "txn-1", currentCategoryId: "groceries" },
      { transactionId: "txn-2", currentCategoryId: "missing-category" },
      { transactionId: "txn-3", currentCategoryId: null },
    ],
    categories,
  );

  assert.deepEqual(drafts, {
    "txn-1": { categoryId: "groceries", note: "", ruleAction: "suggest" },
    "txn-2": { categoryId: "", note: "", ruleAction: "suggest" },
    "txn-3": { categoryId: "", note: "", ruleAction: "suggest" },
  });
});

test("batch save results preserve per-transaction partial and local outcomes", () => {
  const resolutions = buildBatchResolutions([
    {
      transactionId: "txn-1",
      persisted: true,
      ruleAction: "create",
      ruleError: "category_rules insert failed",
    },
    {
      transactionId: "txn-2",
      persisted: false,
      ruleAction: "suggest",
    },
    {
      transactionId: "txn-3",
      persisted: true,
      ruleAction: "create",
      dedupe: "exists",
    },
  ]);

  assert.equal(resolutions["txn-1"].persisted, true);
  assert.equal(resolutions["txn-1"].tone, "partial");
  assert.match(resolutions["txn-1"].message, /rule couldn.t be saved/);
  assert.equal(resolutions["txn-2"].persisted, false);
  assert.equal(resolutions["txn-2"].tone, "local");
  assert.equal(resolutions["txn-3"].tone, "success");
  assert.match(resolutions["txn-3"].message, /matching rule already exists/);
});

test("batch save cleanup only removes transactions returned by the API", () => {
  const results = [
    { transactionId: "txn-1", persisted: true },
    { transactionId: "txn-3", persisted: true },
  ];
  const savedIds = getBatchResultIds(results);

  assert.deepEqual(
    [...removeReviewIds(["txn-1", "txn-2", "txn-3"], savedIds)].sort(),
    ["txn-2"],
  );
  assert.deepEqual(
    clearReviewErrors(
      {
        "txn-1": "Choose a subcategory first.",
        "txn-2": "Still staged.",
        "txn-3": "Old error.",
      },
      savedIds,
    ),
    { "txn-2": "Still staged." },
  );
});

test("batch notice escalates partial rule failures over successful saves", () => {
  const results = [
    { transactionId: "txn-1", persisted: true, ruleAction: "suggest" },
    {
      transactionId: "txn-2",
      persisted: true,
      ruleAction: "suggest",
      ruleSuggestionError: "category_rule_suggestions insert failed",
    },
  ];
  const notice = describeBatchNotice(results, buildBatchResolutions(results));

  assert.equal(notice.tone, "partial");
  assert.equal(
    notice.message,
    "Saved 2 reviews; some rule actions need another attempt.",
  );
});

test("batch notice stays local only when every accepted result is local-only", () => {
  const localResults = [
    { transactionId: "txn-1", persisted: false },
    { transactionId: "txn-2", persisted: false },
  ];
  const mixedResults = [
    { transactionId: "txn-1", persisted: false },
    { transactionId: "txn-2", persisted: true },
  ];

  assert.deepEqual(
    describeBatchNotice(localResults, buildBatchResolutions(localResults)),
    { tone: "local", message: "Saved 2 reviews in one batch." },
  );
  assert.deepEqual(
    describeBatchNotice(mixedResults, buildBatchResolutions(mixedResults)),
    { tone: "success", message: "Saved 2 reviews in one batch." },
  );
  assert.equal(
    describeBatchNotice(
      [{ transactionId: "txn-1", persisted: true }],
      buildBatchResolutions([{ transactionId: "txn-1", persisted: true }]),
    ).message,
    "Saved 1 review in one batch.",
  );
});
