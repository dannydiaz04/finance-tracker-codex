import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  buildTargetFilename,
  finalizeDownload,
  renameExistingDownload,
} from "../../scripts/backfill/lib/downloads.ts";
import { createSafeLogger } from "../../scripts/backfill/lib/logging.ts";

const chunk = {
  startDate: "2023-01-01",
  endDate: "2023-03-31",
};

function createSilentLogger(messages = []) {
  return {
    info(message) {
      messages.push(message);
    },
    warn(message) {
      messages.push(message);
    },
    error(message) {
      messages.push(message);
    },
  };
}

test("builds deterministic backfill filenames from portal prefix and date chunk", () => {
  assert.equal(
    buildTargetFilename("discover_all_available_", chunk),
    "discover_all_available_2023-01-01_2023-03-31.csv",
  );
});

test("finalizes browser downloads using the ingestion-safe target filename", async () => {
  const dropboxDir = mkdtempSync(join(tmpdir(), "finance-backfill-download-"));
  const messages = [];
  const download = {
    suggestedFilename() {
      return "Activity.csv";
    },
    async saveAs(targetPath) {
      writeFileSync(targetPath, "date,amount\n2023-01-01,10\n", "utf8");
    },
  };

  const targetPath = await finalizeDownload(
    download,
    dropboxDir,
    "amex_activity_",
    chunk,
    createSilentLogger(messages),
  );

  assert.equal(basename(targetPath), "amex_activity_2023-01-01_2023-03-31.csv");
  assert.equal(readFileSync(targetPath, "utf8"), "date,amount\n2023-01-01,10\n");
  assert.deepEqual(messages, [
    "Saved export as amex_activity_2023-01-01_2023-03-31.csv (browser suggested: Activity.csv)",
  ]);
});

test("renames existing downloads into the dropbox naming contract", async () => {
  const dropboxDir = mkdtempSync(join(tmpdir(), "finance-backfill-rename-"));
  const sourcePath = join(dropboxDir, "browser-default.csv");
  const messages = [];
  writeFileSync(sourcePath, "date,amount\n2023-01-01,10\n", "utf8");

  const targetPath = await renameExistingDownload(
    sourcePath,
    dropboxDir,
    "capital_one_360_checking_5980_",
    chunk,
    createSilentLogger(messages),
  );

  assert.equal(
    basename(targetPath),
    "capital_one_360_checking_5980_2023-01-01_2023-03-31.csv",
  );
  assert.equal(existsSync(sourcePath), false);
  assert.equal(readFileSync(targetPath, "utf8"), "date,amount\n2023-01-01,10\n");
  assert.deepEqual(messages, [
    "Renamed download to capital_one_360_checking_5980_2023-01-01_2023-03-31.csv",
  ]);
});

test("redacts passwords, tokens, one-time codes, and OAuth codes from logs", () => {
  const originalLog = console.log;
  const lines = [];

  console.log = (line) => {
    lines.push(line);
  };

  try {
    const log = createSafeLogger("capital_one");

    log.info(
      "BACKFILL_CAPITAL_ONE_PASSWORD=hunter2 password=secret token=abc otp=123 https://bank.example/callback?code=oauth-secret",
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(lines, [
    "[backfill:capital_one] [REDACTED] [REDACTED] [REDACTED] [REDACTED] https://bank.example/callback[REDACTED]",
  ]);
});
