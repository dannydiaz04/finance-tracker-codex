import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runLandingImports } from "../../lib/import/runner.ts";

const fixturesDirectory = join(process.cwd(), "tests/fixtures/imports");

function loadFixture(fileName) {
  return readFileSync(join(fixturesDirectory, fileName), "utf8");
}

function createLandingRoot() {
  return mkdtempSync(join(tmpdir(), "finance-tracker-runner-"));
}

function writeLandingFile(landingRoot, relativePath, contents) {
  const targetPath = join(landingRoot, "incoming", relativePath);
  mkdirSync(join(targetPath, ".."), { recursive: true });
  writeFileSync(targetPath, contents, "utf8");
  return targetPath;
}

function writeContextManifest(filePath, contents) {
  writeFileSync(`${filePath}.context.json`, `${JSON.stringify(contents, null, 2)}\n`);
}

test("Runner archives a landed CSV after persisting through the shared import path", async () => {
  const landingRoot = createLandingRoot();
  const filePath = writeLandingFile(
    landingRoot,
    "discover/2026/04/13/Discover-AllAvailable-20260409.csv",
    loadFixture("discover_all_available.csv"),
  );

  writeContextManifest(filePath, {
    sourceAccountId: "discover_card",
    accountName: "Discover Card",
    accountMask: "7788",
  });

  let persistedImport = null;

  const summary = await runLandingImports({
    landingRoot,
    persistImport: async (parsedImport) => {
      persistedImport = parsedImport;
      return {
        persisted: true,
        reason: "Rows inserted into raw_finance datasets.",
      };
    },
    now: () => new Date("2026-04-13T12:00:00.000Z"),
  });

  assert.equal(summary.processedCount, 1);
  assert.equal(summary.archivedCount, 1);
  assert.equal(summary.rejectedCount, 0);
  assert.ok(persistedImport);
  assert.equal(persistedImport.importBatch.status, "loaded");

  const [result] = summary.results;

  assert.equal(result.status, "archived");
  assert.equal(result.fileFormat, "csv");
  assert.equal(result.failureReason, null);
  assert.equal(result.mappingResolutionStrategy, "profile");
  assert.equal(result.mappingProfileId, "discover.all_available.csv.v1");
  assert.deepEqual(result.matchedBy, ["filename", "header-signature"]);
  assert.equal(result.importBatchId, persistedImport.importBatch.importBatchId);
  assert.equal(result.rowCount, persistedImport.importBatch.rowCount);
  assert.ok(result.fileChecksum.length > 0);
  assert.ok(result.fileSizeBytes > 0);
  assert.ok(result.archivedFilePath);
  assert.ok(result.contextManifestPath);
  assert.ok(result.resultManifestPath);
  assert.equal(existsSync(result.archivedFilePath), true);
  assert.equal(existsSync(result.contextManifestPath), true);
  assert.equal(existsSync(result.resultManifestPath), true);
  assert.equal(
    existsSync(
      join(
        landingRoot,
        "processing",
        "discover/2026/04/13/Discover-AllAvailable-20260409.csv",
      ),
    ),
    false,
  );

  const manifest = JSON.parse(readFileSync(result.resultManifestPath, "utf8"));
  assert.equal(manifest.status, "archived");
  assert.equal(manifest.importBatchId, persistedImport.importBatch.importBatchId);
});

test("Runner rejects unsupported landed files and writes a rejection manifest", async () => {
  const landingRoot = createLandingRoot();

  writeLandingFile(
    landingRoot,
    "manual/2026/04/13/transactions.json",
    JSON.stringify([{ amount: 1 }]),
  );

  const summary = await runLandingImports({
    landingRoot,
    now: () => new Date("2026-04-13T12:00:00.000Z"),
  });

  assert.equal(summary.processedCount, 1);
  assert.equal(summary.archivedCount, 0);
  assert.equal(summary.rejectedCount, 1);

  const [result] = summary.results;

  assert.equal(result.status, "rejected");
  assert.equal(result.failureReason, "UNSUPPORTED_FORMAT");
  assert.equal(result.importBatchId, null);
  assert.ok(result.rejectedFilePath);
  assert.ok(result.resultManifestPath);
  assert.equal(existsSync(result.rejectedFilePath), true);
  assert.equal(existsSync(result.resultManifestPath), true);

  const manifest = JSON.parse(readFileSync(result.resultManifestPath, "utf8"));
  assert.equal(manifest.status, "rejected");
  assert.equal(manifest.failureReason, "UNSUPPORTED_FORMAT");
});
