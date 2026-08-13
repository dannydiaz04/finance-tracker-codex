import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const scriptPath = join(repoRoot, "scripts/process-dropbox.sh");
const dropboxDirectory = join(repoRoot, "dropbox");

function baseEnv(overrides = {}) {
  return {
    PATH: process.env.PATH ?? "",
    ...overrides,
  };
}

function runProcessDropbox(args, env = baseEnv()) {
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

function listDropboxCsvFiles() {
  return readdirSync(dropboxDirectory).filter((entry) =>
    entry.toLowerCase().endsWith(".csv"),
  );
}

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o755 });
}

test("process-dropbox refuses real ingest without a user id", (t) => {
  if (existsSync(join(repoRoot, ".env.local"))) {
    t.skip(".env.local may intentionally provide WAREHOUSE_IMPORT_USER_ID");
    return;
  }

  const result = runProcessDropbox(["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
});

test("process-dropbox forwards an explicit user id to the landed import runner", (t) => {
  const preExistingCsvFiles = listDropboxCsvFiles();
  if (preExistingCsvFiles.length > 0) {
    t.skip(
      `dropbox contains pre-existing CSV files: ${preExistingCsvFiles.join(", ")}`,
    );
    return;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-test-"));
  const stubBin = join(tempRoot, "bin");
  const callsLog = join(tempRoot, "calls.log");
  mkdirSync(stubBin, { recursive: true });

  writeExecutable(
    join(stubBin, "gcloud"),
    `#!/usr/bin/env bash
printf 'gcloud %s\\n' "$*" >> "${callsLog}"
exit 0
`,
  );
  writeExecutable(
    join(stubBin, "npm"),
    `#!/usr/bin/env bash
printf 'npm %s\\n' "$*" >> "${callsLog}"
exit 0
`,
  );

  const csvPath = join(dropboxDirectory, "manual-process-dropbox-test.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-08-12,Smoke Test,1.23\n");

  try {
    const result = runProcessDropbox(
      ["--no-dataform", "--user-id", "user-abc"],
      baseEnv({
        ETL_MAX_FILES: "7",
        PATH: `${stubBin}:${process.env.PATH ?? ""}`,
        WAREHOUSE_LANDING_BUCKET: "unit-test-landing",
      }),
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Uploaded 1 file\(s\)/);

    const calls = readFileSync(callsLog, "utf8");
    assert.match(
      calls,
      /gcloud storage cp .*manual-process-dropbox-test\.csv gs:\/\/unit-test-landing\/incoming\/manual\//,
    );
    assert.match(
      calls,
      /npm run etl:runner -- --gcs-bucket unit-test-landing --max-files 7 --user-id user-abc/,
    );
  } finally {
    rmSync(csvPath, { force: true });

    for (const uploadedDirectory of ["_uploaded"]) {
      const uploadedRoot = join(dropboxDirectory, uploadedDirectory);
      if (!existsSync(uploadedRoot)) {
        continue;
      }

      const movedFiles = readdirSync(uploadedRoot, { recursive: true })
        .map((entry) => join(uploadedRoot, String(entry)))
        .filter((entry) => basename(entry) === "manual-process-dropbox-test.csv");

      for (const movedFile of movedFiles) {
        rmSync(movedFile, { force: true });
      }
    }

    rmSync(tempRoot, { recursive: true, force: true });
  }
});
