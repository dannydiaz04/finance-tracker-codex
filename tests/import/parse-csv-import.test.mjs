import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseCsvImport } from "../../lib/import/csv.ts";

const fixturesDirectory = join(process.cwd(), "tests/fixtures/imports");
const corePayloadFields = [
  "sourceTransactionId",
  "sourceAccountId",
  "accountName",
  "postedAt",
  "authorizedAt",
  "descriptionRaw",
  "merchantRaw",
  "institutionCategory",
  "pending",
  "signedAmount",
  "direction",
  "transactionClass",
  "rawPayloadJson",
  "merchantNorm",
  "descriptionNorm",
  "keywordArray",
];

function loadFixture(fileName) {
  return readFileSync(join(fixturesDirectory, fileName), "utf8");
}

function assertCanonicalPayloadShape(row) {
  for (const field of corePayloadFields) {
    assert.ok(
      Object.hasOwn(row, field),
      `Expected canonical payload field ${field}`,
    );
  }

  assert.equal(typeof row.rawPayloadJson, "object");
  assert.ok(Array.isArray(row.keywordArray));
}

const profileFixtures = [
  {
    label: "Capital One 360 Checking",
    fixtureFile: "capital_one_360_checking_5980.csv",
    fileName: "2026-04-09_360Checking_5980.csv",
    profileId: "capital_one.360_checking_5980.csv.v1",
    matchedBy: ["filename"],
    expected: {
      sourceAccountId: "capital_one_360_checking_5980",
      accountName: "Capital One 360 Checking",
      accountMask: "5980",
      postedAt: "2026-04-01",
      pending: false,
      signedAmount: -25.5,
      runningBalance: "1240.10",
    },
  },
  {
    label: "Apple Card",
    fixtureFile: "apple_card_transactions.csv",
    fileName: "Apple Card Transactions Apr 01.csv",
    profileId: "apple_card.transactions.csv.v1",
    matchedBy: ["filename"],
    expected: {
      sourceAccountId: "apple_card",
      accountName: "Apple Card",
      postedAt: "2026-04-01",
      authorizedAt: "2026-04-01T00:00:00.000Z",
      pending: true,
      signedAmount: -5.25,
      transactionType: "Purchase",
      currencyCode: "USD",
    },
  },
  {
    label: "Chase Card",
    fixtureFile: "chase_card_1325.csv",
    fileName: "Chase1325_Activity20260409.csv",
    profileId: "chase.card_1325.csv.v1",
    matchedBy: ["filename"],
    expected: {
      sourceAccountId: "chase_card_1325",
      accountName: "Chase Card 1325",
      accountMask: "1325",
      postedAt: "2026-04-01",
      authorizedAt: "2026-04-01T00:00:00.000Z",
      pending: true,
      signedAmount: -17.99,
    },
  },
  {
    label: "American Express Activity",
    fixtureFile: "american_express_activity.csv",
    fileName: "activity.csv",
    runtimeAccountContext: {
      sourceAccountId: "american_express_card",
      accountName: "American Express Card",
      accountMask: "2001",
    },
    profileId: "american_express.activity.csv.v1",
    matchedBy: ["filename", "header-signature"],
    expected: {
      sourceTransactionId: "REF-123",
      sourceAccountId: "american_express_card",
      accountName: "American Express Card",
      accountMask: "2001",
      postedAt: "2026-04-01",
      authorizedAt: null,
      pending: false,
      signedAmount: -12.4,
      referenceNumber: "REF-123",
      memo: "IN PERSON",
      merchantPostalCode: "60601",
      merchantCountry: "US",
    },
  },
  {
    label: "Micro Center Card",
    fixtureFile: "micro_center_credit_card_1.csv",
    fileName: "CreditCard1.csv",
    runtimeAccountContext: {
      sourceAccountId: "micro_center_card",
      accountName: "Micro Center Card",
      accountMask: "4242",
    },
    profileId: "micro_center.credit_card_1.csv.v1",
    matchedBy: ["filename", "column-shape"],
    expected: {
      sourceAccountId: "micro_center_card",
      accountName: "Micro Center Card",
      accountMask: "4242",
      postedAt: "2026-04-01",
      authorizedAt: "2026-04-01T00:00:00.000Z",
      pending: false,
      signedAmount: -129.99,
      currencyCode: "USD",
    },
  },
  {
    label: "Discover All Available",
    fixtureFile: "discover_all_available.csv",
    fileName: "Discover-AllAvailable-20260409.csv",
    runtimeAccountContext: {
      sourceAccountId: "discover_card",
      accountName: "Discover Card",
      accountMask: "7788",
    },
    profileId: "discover.all_available.csv.v1",
    matchedBy: ["filename", "header-signature"],
    expected: {
      sourceAccountId: "discover_card",
      accountName: "Discover Card",
      accountMask: "7788",
      postedAt: "2026-04-01",
      authorizedAt: "2026-04-01T00:00:00.000Z",
      pending: true,
      signedAmount: -18.75,
      currencyCode: "USD",
    },
  },
];

for (const fixture of profileFixtures) {
  test(`${fixture.label} fixture resolves explicit source profile`, () => {
    const csv = loadFixture(fixture.fixtureFile);
    const firstParse = parseCsvImport(csv, {
      fileName: fixture.fileName,
      runtimeAccountContext: fixture.runtimeAccountContext,
    });
    const replayParse = parseCsvImport(csv, {
      fileName: fixture.fileName,
      runtimeAccountContext: fixture.runtimeAccountContext,
    });
    const row = firstParse.normalizedRows[0];
    const replayRow = replayParse.normalizedRows[0];

    assert.equal(firstParse.mappingResolution.strategy, "profile");
    assert.equal(firstParse.mappingResolution.profileId, fixture.profileId);
    assert.deepEqual(firstParse.mappingResolution.matchedBy, fixture.matchedBy);
    assertCanonicalPayloadShape(row);
    assert.equal(row.sourceTransactionId, replayRow.sourceTransactionId);
    assert.ok(row.sourceTransactionId.length > 0);

    for (const [field, expectedValue] of Object.entries(fixture.expected)) {
      assert.deepEqual(row[field], expectedValue, `${fixture.label} ${field}`);
    }
  });
}

test("Generic CSV falls back to header inference when no source profile matches", () => {
  const csv = loadFixture("generic_fallback.csv");
  const parsed = parseCsvImport(csv, {
    fileName: "manual-upload.csv",
    runtimeAccountContext: {
      sourceAccountId: "manual_checking",
      accountName: "Manual Checking",
      accountMask: "1111",
    },
  });
  const row = parsed.normalizedRows[0];

  assert.equal(parsed.mappingResolution.strategy, "inferred");
  assertCanonicalPayloadShape(row);
  assert.equal(row.sourceAccountId, "manual_checking");
  assert.equal(row.accountName, "Manual Checking");
  assert.equal(row.accountMask, "1111");
  assert.equal(row.postedAt, "2026-04-01");
  assert.equal(row.signedAmount, -9.99);
});
