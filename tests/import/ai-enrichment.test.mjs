import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAiEnrichmentInsertRows,
  getTaxonomyVersion,
  parseCategoryClassifierResponse,
} from "../../lib/ai-enrichment/category-classifier.ts";

const categories = [
  {
    categoryId: "dining",
    label: "Dining",
    categoryL1: "Lifestyle",
    categoryL2: "Restaurants",
  },
  {
    categoryId: "groceries",
    label: "Groceries",
    categoryL1: "Essential",
    categoryL2: "Food at home",
  },
  {
    categoryId: "salary",
    label: "Salary",
    categoryL1: "Income",
    categoryL2: "Payroll",
  },
  {
    categoryId: "uncategorized",
    label: "Uncategorized",
    categoryL1: "Review",
    categoryL2: "Needs classification",
  },
];

const baseTransaction = {
  transactionId: "txn-1",
  accountId: "card-1",
  accountName: "Card 1",
  postedAt: "2026-04-13",
  signedAmount: -12.5,
  merchantRaw: "Lunch Shop #123",
  merchantNorm: "lunch shop",
  descriptionRaw: "Lunch Shop #123",
  descriptionNorm: "lunch shop",
  institutionCategory: "Food & Dining",
  derivedCategoryId: "uncategorized",
  categoryLabel: "Uncategorized",
  transactionClass: "expense",
  classificationSource: "fallback",
  confidenceScore: 0.55,
  keywordArray: ["lunch", "shop"],
  enrichmentReason: "No deterministic category matched.",
};

test("AI classifier parser accepts fenced JSON results", () => {
  const suggestions = parseCategoryClassifierResponse(`\`\`\`json
{
  "results": [
    {
      "transactionId": "txn-1",
      "categoryId": "dining",
      "confidence": 0.91,
      "normalizedMerchant": "Lunch Shop",
      "secondaryCandidates": [{ "categoryId": "groceries", "confidence": 0.05 }],
      "signals": ["merchant phrase"],
      "reason": "Lunch merchant pattern."
    }
  ]
}
\`\`\``);

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].transactionId, "txn-1");
  assert.equal(suggestions[0].categoryId, "dining");
  assert.equal(suggestions[0].confidence, 0.91);
  assert.deepEqual(suggestions[0].signals, ["merchant phrase"]);
});

test("AI enrichment rows accept high-confidence taxonomy-backed suggestions", () => {
  const [row] = buildAiEnrichmentInsertRows({
    runId: "run-1",
    responseId: "resp-1",
    model: "gpt-test",
    taxonomyVersion: getTaxonomyVersion(categories),
    transactions: [baseTransaction],
    categories,
    suggestions: [
      {
        transactionId: "txn-1",
        categoryId: "dining",
        confidence: 0.91,
        normalizedMerchant: "Lunch Shop",
        secondaryCandidates: [{ categoryId: "groceries", confidence: 0.05 }],
        signals: ["merchant phrase"],
        reason: "Lunch merchant pattern.",
      },
    ],
    createdAt: new Date("2026-04-13T12:00:00.000Z"),
  });

  assert.equal(row.status, "accepted");
  assert.equal(row.review_required, false);
  assert.equal(row.suggested_category_id, "dining");
  assert.equal(row.suggested_category_label, "Dining");
  assert.equal(row.model_confidence_score, 0.91);
  assert.equal(row.confidence_score, 0.96);
  assert.equal(row.created_at, "2026-04-13T12:00:00.000Z");
  assert.doesNotThrow(() => JSON.parse(row.input_json));
  assert.doesNotThrow(() => JSON.parse(row.model_output_json));
  assert.doesNotThrow(() => JSON.parse(row.secondary_candidates_json));
});

test("AI enrichment rows route low-confidence valid suggestions to review", () => {
  const [row] = buildAiEnrichmentInsertRows({
    runId: "run-1",
    responseId: "resp-1",
    model: "gpt-test",
    taxonomyVersion: getTaxonomyVersion(categories),
    transactions: [
      {
        ...baseTransaction,
        institutionCategory: null,
      },
    ],
    categories,
    suggestions: [
      {
        transactionId: "txn-1",
        categoryId: "groceries",
        confidence: 0.72,
        secondaryCandidates: [{ categoryId: "dining", confidence: 0.68 }],
        signals: ["merchant phrase"],
        reason: "Market-like merchant pattern.",
      },
    ],
  });

  assert.equal(row.status, "needs_review");
  assert.equal(row.review_required, true);
  assert.equal(row.confidence_score, 0.62);
  assert.ok(row.confidence_notes.includes("Top category is close to a secondary candidate."));
});

test("AI enrichment rows reject categories outside the taxonomy", () => {
  const [row] = buildAiEnrichmentInsertRows({
    runId: "run-1",
    responseId: "resp-1",
    model: "gpt-test",
    taxonomyVersion: getTaxonomyVersion(categories),
    transactions: [baseTransaction],
    categories,
    suggestions: [
      {
        transactionId: "txn-1",
        categoryId: "shopping",
        confidence: 0.99,
        signals: ["merchant phrase"],
        reason: "Unsupported taxonomy category.",
      },
    ],
  });

  assert.equal(row.status, "rejected");
  assert.equal(row.review_required, true);
  assert.equal(row.confidence_score, 0);
  assert.equal(row.suggested_category_label, null);
});
