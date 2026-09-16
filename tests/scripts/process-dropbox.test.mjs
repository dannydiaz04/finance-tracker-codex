import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createHarness({ envLocal } = {}) {
  const root = mkdtempSync(join(tmpdir(), "finance-dropbox-script-"));
  const scriptPath = join(root, "scripts/process-dropbox.sh");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const callLogPath = join(root, "calls.log");

  mkdirSync(dirname(scriptPath), { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  if (envLocal) {
    writeFileSync(join(root, ".env.local"), envLocal, "utf8");
  }

  const fakeCommand = `#!/usr/bin/env bash
{
  printf '%s' "\${0##*/}"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$CALL_LOG"
`;

  writeExecutable(join(binDirectory, "gcloud"), fakeCommand);
  writeExecutable(join(binDirectory, "npm"), fakeCommand);
  writeExecutable(join(binDirectory, "npx"), fakeCommand);

  return {
    root,
    scriptPath,
    dropboxDirectory,
    binDirectory,
    callLogPath,
  };
}

function createTestHarness(t, options) {
  const harness = createHarness(options);

  t.after(() => {
    rmSync(harness.root, { recursive: true, force: true });
  });

  return harness;
}

function runScript(harness, args = [], envOverrides = {}) {
  const env = {
    ...process.env,
    ...envOverrides,
    CALL_LOG: harness.callLogPath,
    PATH: `${harness.binDirectory}:${process.env.PATH ?? ""}`,
  };

  for (const key of [
    "ETL_MAX_FILES",
    "WAREHOUSE_IMPORT_USER_ID",
    "WAREHOUSE_LANDING_BUCKET",
  ]) {
    if (!Object.hasOwn(envOverrides, key)) {
      delete env[key];
    }
  }

  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    encoding: "utf8",
    env,
  });
}

function readCalls(harness) {
  if (!existsSync(harness.callLogPath)) {
    return [];
  }

  return readFileSync(harness.callLogPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean);
}

function writeDropboxCsv(harness, fileName = "chase-activity.csv") {
  const csvPath = join(harness.dropboxDirectory, fileName);
  writeFileSync(
    csvPath,
    "Date,Description,Amount\n2026-04-01,Coffee,-5.00\n",
    "utf8",
  );
  return csvPath;
}

test("Dropbox ingest refuses a real run without a user id before side effects", (t) => {
  const harness = createTestHarness(t);
  const csvPath = writeDropboxCsv(harness);

  const result = runScript(harness);

  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.deepEqual(readCalls(harness), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(harness.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest dry-run does not require a user id or call external commands", (t) => {
  const harness = createTestHarness(t);
  const csvPath = writeDropboxCsv(harness);

  const result = runScript(harness, ["--dry-run"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /chase-activity\.csv\s+->\s+chase/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.deepEqual(readCalls(harness), []);
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest loads user id and bucket from .env.local before upload and ETL", (t) => {
  const harness = createTestHarness(t, {
    envLocal: [
      "WAREHOUSE_IMPORT_USER_ID='env-user-123'",
      'WAREHOUSE_LANDING_BUCKET="custom-finance-bucket"',
      "",
    ].join("\n"),
  });
  const csvPath = writeDropboxCsv(harness, "discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

  const result = runScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stdout + result.stderr);

  const calls = readCalls(harness);
  assert.equal(calls.length, 3);
  assert.match(
    calls[0],
    /^gcloud\tstorage\tcp\t.*\/discover-export\.csv\tgs:\/\/custom-finance-bucket\/incoming\/discover\/\d{4}\/\d{2}\/\d{2}\/discover-export\.csv$/,
  );
  assert.match(
    calls[1],
    /^gcloud\tstorage\tcp\t.*\/discover-export\.csv\.context\.json\tgs:\/\/custom-finance-bucket\/incoming\/discover\/\d{4}\/\d{2}\/\d{2}\/discover-export\.csv\.context\.json$/,
  );
  assert.equal(
    calls[2],
    "npm\trun\tetl:runner\t--\t--gcs-bucket\tcustom-finance-bucket\t--max-files\t50\t--user-id\tenv-user-123",
  );

  const [uploadedDate] = readdirSync(join(harness.dropboxDirectory, "_uploaded"));
  assert.match(uploadedDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(existsSync(csvPath), false);
  assert.equal(
    existsSync(
      join(
        harness.dropboxDirectory,
        "_uploaded",
        uploadedDate,
        "discover-export.csv",
      ),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(
        harness.dropboxDirectory,
        "_uploaded",
        uploadedDate,
        "discover-export.csv.context.json",
      ),
    ),
    true,
  );
});
