import assert from "node:assert/strict";
import test from "node:test";

import { ZodError } from "zod";

import { batchOverrideRequestSchema } from "../../lib/categorization/override-batch-request.ts";

function override(overrides = {}) {
  return {
    transactionId: "txn-1",
    categoryId: "groceries",
    ...overrides,
  };
}

test("batch override request accepts the route payload shape", () => {
  const payload = batchOverrideRequestSchema.parse({
    overrides: [
      override({
        note: "Corrected during receipt review",
        ruleAction: "create",
      }),
    ],
  });

  assert.deepEqual(payload, {
    overrides: [
      {
        transactionId: "txn-1",
        categoryId: "groceries",
        note: "Corrected during receipt review",
        ruleAction: "create",
      },
    ],
  });
});

test("batch override request rejects duplicate transaction ids", () => {
  assert.throws(
    () =>
      batchOverrideRequestSchema.parse({
        overrides: [
          override({ transactionId: "txn-1" }),
          override({ transactionId: "txn-1", categoryId: "dining" }),
        ],
      }),
    (error) => {
      assert.ok(error instanceof ZodError);
      assert.deepEqual(error.issues[0]?.path, ["overrides", 1, "transactionId"]);
      assert.equal(
        error.issues[0]?.message,
        "Each transaction can appear only once in a batch.",
      );
      return true;
    },
  );
});

test("batch override request rejects empty and overlarge batches", () => {
  assert.throws(
    () => batchOverrideRequestSchema.parse({ overrides: [] }),
    ZodError,
  );

  assert.throws(
    () =>
      batchOverrideRequestSchema.parse({
        overrides: Array.from({ length: 101 }, (_, index) =>
          override({ transactionId: `txn-${index}` }),
        ),
      }),
    ZodError,
  );
});
