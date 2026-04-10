import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { parseCsvImport } from "../../lib/import/csv.ts";
import {
  toRawImportBatchInsertRow,
  toRawTransactionEventInsertRows,
} from "../../lib/import/persistence.ts";

const fixturesDirectory = join(process.cwd(), "tests/fixtures/imports");

function loadFixture(fileName) {
  return readFileSync(join(fixturesDirectory, fileName), "utf8");
}

test("Profile-backed imports map import batch metadata to snake_case BigQuery fields", () => {
  const parsed = parseCsvImport(loadFixture("american_express_activity.csv"), {
    fileName: "activity.csv",
    runtimeAccountContext: {
      sourceAccountId: "american_express_card",
      accountName: "American Express Card",
      accountMask: "2001",
    },
  });
  const batchRow = toRawImportBatchInsertRow(parsed);
  const [eventRow] = toRawTransactionEventInsertRows(parsed);

  assert.deepEqual(Object.keys(batchRow).sort(), [
    "file_name",
    "import_batch_id",
    "imported_at",
    "mapping_matched_by",
    "mapping_profile_id",
    "mapping_resolution_strategy",
    "row_count",
    "runtime_account_mask",
    "runtime_account_name",
    "runtime_source_account_id",
    "source_name",
    "status",
  ]);
  assert.equal(batchRow.import_batch_id, parsed.importBatch.importBatchId);
  assert.equal(batchRow.source_name, "csv");
  assert.equal(batchRow.imported_at, parsed.importBatch.importedAt);
  assert.equal(batchRow.row_count, parsed.importBatch.rowCount);
  assert.equal(batchRow.file_name, "activity.csv");
  assert.equal(batchRow.mapping_profile_id, "american_express.activity.csv.v1");
  assert.equal(batchRow.mapping_resolution_strategy, "profile");
  assert.deepEqual(batchRow.mapping_matched_by, ["filename", "header-signature"]);
  assert.equal(batchRow.runtime_source_account_id, "american_express_card");
  assert.equal(batchRow.runtime_account_name, "American Express Card");
  assert.equal(batchRow.runtime_account_mask, "2001");

  assert.deepEqual(Object.keys(eventRow).sort(), [
    "event_id",
    "event_timestamp",
    "event_type",
    "import_batch_id",
    "payload",
    "source_account_id",
    "source_name",
    "source_transaction_id",
  ]);
  assert.equal(eventRow.event_id, parsed.events[0].eventId);
  assert.equal(eventRow.import_batch_id, parsed.events[0].importBatchId);
  assert.equal(eventRow.source_name, "csv");
  assert.equal(eventRow.source_transaction_id, parsed.events[0].sourceTransactionId);
  assert.equal(eventRow.source_account_id, "american_express_card");
  assert.equal(eventRow.event_type, "added");
  assert.equal(eventRow.event_timestamp, parsed.events[0].eventTimestamp);
  assert.equal(typeof eventRow.payload, "string");
  assert.deepEqual(JSON.parse(eventRow.payload), parsed.events[0].payload);
});

test("Fallback header inference still persists explicit mapping metadata", () => {
  const parsed = parseCsvImport(loadFixture("generic_fallback.csv"), {
    fileName: "manual-upload.csv",
    runtimeAccountContext: {
      sourceAccountId: "manual_checking",
      accountName: "Manual Checking",
      accountMask: "1111",
    },
  });
  const batchRow = toRawImportBatchInsertRow(parsed);

  assert.equal(batchRow.mapping_profile_id, null);
  assert.equal(batchRow.mapping_resolution_strategy, "inferred");
  assert.deepEqual(batchRow.mapping_matched_by, ["fallback-header-inference"]);
  assert.equal(batchRow.runtime_source_account_id, "manual_checking");
  assert.equal(batchRow.runtime_account_name, "Manual Checking");
  assert.equal(batchRow.runtime_account_mask, "1111");
});
