import assert from "node:assert/strict";
import test from "node:test";

import { describeSuggestionResolution } from "../../lib/categorization/rule-suggestion-state.ts";

test("accepting a new suggestion confirms the rule was saved", () => {
  const resolution = describeSuggestionResolution({
    action: "accept",
    payload: { status: "accepted", persisted: true, dedupe: "new" },
  });
  assert.equal(resolution.state, "accepted");
  assert.equal(resolution.headline, "Moved to Active rules");
  assert.match(resolution.detail, /refreshing in the background/);
});

test("accepting over a conflicting rule says the old one was replaced", () => {
  const resolution = describeSuggestionResolution({
    action: "accept",
    payload: { status: "accepted", persisted: true, dedupe: "conflict" },
  });
  assert.match(resolution.detail, /replaced/);
});

test("accepting a duplicate reports that nothing was written twice", () => {
  const resolution = describeSuggestionResolution({
    action: "accept",
    payload: { status: "accepted", persisted: true, dedupe: "exists" },
  });
  assert.equal(resolution.headline, "Already active");
  assert.match(resolution.detail, /already exists/);
});

test("dismissing confirms the suggestion will not return", () => {
  const resolution = describeSuggestionResolution({
    action: "dismiss",
    payload: { status: "dismissed", persisted: true },
  });
  assert.equal(resolution.state, "dismissed");
  assert.equal(resolution.headline, "Dismissed");
  assert.match(resolution.detail, /won’t come back/);
});

test("sample mode is reported as a local-only save", () => {
  assert.match(
    describeSuggestionResolution({ action: "accept", payload: { persisted: false } }).detail,
    /Saved locally/,
  );
  assert.match(
    describeSuggestionResolution({ action: "dismiss", payload: { persisted: false } }).detail,
    /Dismissed locally/,
  );
});

test("a response without a persisted flag is treated as persisted", () => {
  const resolution = describeSuggestionResolution({ action: "accept", payload: null });
  assert.equal(resolution.headline, "Moved to Active rules");
});
