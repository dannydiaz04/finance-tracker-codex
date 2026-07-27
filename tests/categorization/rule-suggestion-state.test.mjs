import assert from "node:assert/strict";
import test from "node:test";

import {
  describeSuggestionResolution,
  updateSuggestionReviewStatus,
} from "../../lib/categorization/rule-suggestion-state.ts";

const suggestion = {
  suggestionId: "suggestion-1",
  transactionId: "transaction-1",
  priority: 110,
  categoryId: "dining",
  categoryLabel: "Dining",
  matchStrategy: "merchant_exact",
  matchValue: "cafe",
  ruleName: "Cafe",
  ruleDescription: "Categorize cafe transactions.",
  source: "manual_override",
  status: "pending",
  note: null,
  createdAt: "2026-07-27T12:00:00.000Z",
  updatedAt: "2026-07-27T12:00:00.000Z",
  reviewedAt: null,
};

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

test("accepting a corrected review confirms the active rule was updated", () => {
  const resolution = describeSuggestionResolution({
    action: "accept",
    payload: {
      status: "accepted",
      persisted: true,
      dedupe: "exists",
      revised: true,
    },
  });
  assert.equal(resolution.headline, "Active rule updated");
  assert.match(resolution.detail, /corrected review/);
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

test("dismissing a reopened accepted review confirms its learned rule was disabled", () => {
  const resolution = describeSuggestionResolution({
    action: "dismiss",
    payload: { status: "dismissed", persisted: true, revised: true },
  });
  assert.equal(resolution.headline, "Learned rule disabled");
  assert.match(resolution.detail, /rule was disabled/);
  assert.match(resolution.detail, /previously replaced remains disabled/);
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

test("review status changes preserve the suggestion and clear review time when reopened", () => {
  const accepted = updateSuggestionReviewStatus(
    suggestion,
    "accepted",
    "2026-07-27T13:00:00.000Z",
  );
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.reviewedAt, "2026-07-27T13:00:00.000Z");

  const reopened = updateSuggestionReviewStatus(
    accepted,
    "pending",
    "2026-07-27T14:00:00.000Z",
  );
  assert.equal(reopened.status, "pending");
  assert.equal(reopened.reviewedAt, null);
  assert.equal(reopened.ruleName, suggestion.ruleName);
});
