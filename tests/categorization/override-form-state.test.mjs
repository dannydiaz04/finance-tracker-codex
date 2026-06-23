import assert from "node:assert/strict";
import test from "node:test";

import {
  describePreview,
  describeSaveResult,
  resolveDefaultCategoryId,
} from "../../lib/categorization/override-form-state.ts";

const categories = [{ id: "groceries" }, { id: "dining" }];

// --- resolveDefaultCategoryId --------------------------------------------------

test("default category is the current one when it's a real option", () => {
  assert.equal(resolveDefaultCategoryId("dining", categories), "dining");
});

test("default category is empty when current is null or not an option", () => {
  assert.equal(resolveDefaultCategoryId(null, categories), "");
  assert.equal(resolveDefaultCategoryId("uncategorized", categories), "");
});

// --- describeSaveResult --------------------------------------------------------

test("save result: network/validation failure is an error", () => {
  assert.deepEqual(describeSaveResult({ ok: false, payload: { error: "Unknown category." } }), {
    tone: "error",
    message: "Unknown category.",
  });
});

test("save result: sample mode reports a local-only save", () => {
  const result = describeSaveResult({ ok: true, payload: { persisted: false } });
  assert.equal(result.tone, "local");
});

test("save result: suggest success mentions the pending rule", () => {
  const result = describeSaveResult({
    ok: true,
    payload: { persisted: true, ruleAction: "suggest", ruleSuggestionPersisted: true },
  });
  assert.equal(result.tone, "success");
  assert.match(result.message, /waiting for review/);
});

test("save result: suggest partial failure is flagged", () => {
  const result = describeSaveResult({
    ok: true,
    payload: { persisted: true, ruleAction: "suggest", ruleSuggestionError: "boom" },
  });
  assert.equal(result.tone, "partial");
});

test("save result: create new rule announces auto-categorization", () => {
  const result = describeSaveResult({
    ok: true,
    payload: { persisted: true, ruleAction: "create", rulePersisted: true, dedupe: "new" },
  });
  assert.equal(result.tone, "success");
  assert.match(result.message, /auto-categorizes/);
});

test("save result: create conflict says the rule was replaced", () => {
  const result = describeSaveResult({
    ok: true,
    payload: { persisted: true, ruleAction: "create", rulePersisted: true, dedupe: "conflict" },
  });
  assert.match(result.message, /replaced/);
});

test("save result: create against an existing rule is a no-op success", () => {
  const result = describeSaveResult({
    ok: true,
    payload: { persisted: true, ruleAction: "create", dedupe: "exists" },
  });
  assert.equal(result.tone, "success");
  assert.match(result.message, /already exists/);
});

test("save result: create partial failure is flagged", () => {
  const result = describeSaveResult({
    ok: true,
    payload: { persisted: true, ruleAction: "create", ruleError: "boom" },
  });
  assert.equal(result.tone, "partial");
});

// --- describePreview -----------------------------------------------------------

test("preview is null when there's nothing to learn", () => {
  assert.equal(describePreview(null), null);
  assert.equal(describePreview({ matchPreview: null }), null);
});

test("preview includes the match count and pluralizes", () => {
  const one = describePreview({ matchPreview: "Auto-categorizes …", matchCount: 1 });
  assert.match(one, /1 of your existing transaction\b/);
  const many = describePreview({ matchPreview: "Auto-categorizes …", matchCount: 4 });
  assert.match(many, /4 of your existing transactions\b/);
});

test("preview surfaces conflict and guardrail notes", () => {
  const result = describePreview({
    matchPreview: "Auto-categorizes …",
    dedupe: "conflict",
    guardrailNote: "“uber” is a broad payment aggregator…",
  });
  assert.match(result, /will replace it/);
  assert.match(result, /aggregator/);
});
