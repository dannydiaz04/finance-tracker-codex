import assert from "node:assert/strict";
import test from "node:test";

import {
  derivePlaidCategoryPrior,
  getPlaidConfidenceWeight,
  mapPlaidCategoryToTaxonomy,
  normalizePlaidConfidenceLevel,
} from "../../lib/ai-enrichment/plaid-category-prior.ts";

test("detailed mappings disambiguate primaries that split across our taxonomy", () => {
  assert.equal(
    mapPlaidCategoryToTaxonomy("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES"),
    "groceries",
  );
  assert.equal(
    mapPlaidCategoryToTaxonomy("FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT"),
    "dining",
  );
  assert.equal(
    mapPlaidCategoryToTaxonomy("INCOME", "INCOME_WAGES"),
    "salary",
  );
  assert.equal(
    mapPlaidCategoryToTaxonomy("LOAN_PAYMENTS", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"),
    "credit-card-payment",
  );
  assert.equal(
    mapPlaidCategoryToTaxonomy("RENT_AND_UTILITIES", "RENT_AND_UTILITIES_RENT"),
    "housing-rent",
  );
});

test("primary fallback maps unambiguous whole primaries", () => {
  assert.equal(mapPlaidCategoryToTaxonomy("BANK_FEES", null), "fees");
  assert.equal(mapPlaidCategoryToTaxonomy("TRANSFER_IN", null), "transfers");
  assert.equal(mapPlaidCategoryToTaxonomy("TRANSFER_OUT", null), "transfers");
  assert.equal(mapPlaidCategoryToTaxonomy("TRAVEL", "TRAVEL_FLIGHTS"), "travel");
});

test("ambiguous or unmapped primaries return null (no misleading prior)", () => {
  // INCOME at the primary level is ambiguous (dividends/interest/refunds are not
  // salary), so only the INCOME_WAGES detailed value maps.
  assert.equal(mapPlaidCategoryToTaxonomy("INCOME", null), null);
  assert.equal(mapPlaidCategoryToTaxonomy("RENT_AND_UTILITIES", null), null);
  assert.equal(mapPlaidCategoryToTaxonomy("ENTERTAINMENT", null), null);
  assert.equal(mapPlaidCategoryToTaxonomy("GENERAL_MERCHANDISE", null), null);
  assert.equal(mapPlaidCategoryToTaxonomy("TRANSPORTATION", null), null);
  assert.equal(mapPlaidCategoryToTaxonomy("MEDICAL", null), null);
});

test("mapping is case-insensitive and tolerates blanks", () => {
  assert.equal(mapPlaidCategoryToTaxonomy("travel", null), "travel");
  assert.equal(mapPlaidCategoryToTaxonomy("  BANK_FEES  ", ""), "fees");
  assert.equal(mapPlaidCategoryToTaxonomy(null, null), null);
});

test("confidence levels normalize and weight monotonically", () => {
  assert.equal(normalizePlaidConfidenceLevel("very_high"), "VERY_HIGH");
  assert.equal(normalizePlaidConfidenceLevel("bogus"), "UNKNOWN");
  assert.equal(normalizePlaidConfidenceLevel(null), "UNKNOWN");

  assert.equal(getPlaidConfidenceWeight("VERY_HIGH"), 1);
  assert.ok(getPlaidConfidenceWeight("HIGH") < getPlaidConfidenceWeight("VERY_HIGH"));
  assert.ok(getPlaidConfidenceWeight("MEDIUM") < getPlaidConfidenceWeight("HIGH"));
  assert.ok(getPlaidConfidenceWeight("LOW") < getPlaidConfidenceWeight("MEDIUM"));
  assert.equal(getPlaidConfidenceWeight("UNKNOWN"), 0);
});

test("derivePlaidCategoryPrior returns a weighted, mapped prior", () => {
  const prior = derivePlaidCategoryPrior({
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_GROCERIES",
    confidenceLevel: "VERY_HIGH",
  });

  assert.deepEqual(prior, {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_GROCERIES",
    confidenceLevel: "VERY_HIGH",
    categoryId: "groceries",
    weight: 1,
  });
});

test("a present-but-unmapped category still yields a prior with null categoryId", () => {
  const prior = derivePlaidCategoryPrior({
    primary: "ENTERTAINMENT",
    detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    confidenceLevel: "HIGH",
  });

  assert.ok(prior);
  assert.equal(prior.categoryId, null);
  assert.equal(prior.weight, 0.8);
});

test("no Plaid category at all yields no prior", () => {
  assert.equal(
    derivePlaidCategoryPrior({
      primary: null,
      detailed: null,
      confidenceLevel: null,
    }),
    null,
  );
});
