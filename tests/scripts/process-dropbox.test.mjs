import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

async function createHarness() {
  const repoRoot = await mkdtemp(join(tmpdir(), "finance-dropbox-script-"));
  const scriptsDirectory = join(repoRoot, "scripts");
  const dropboxDirectory = join(repoRoot, "dropbox");
  const fakeBinDirectory = join(repoRoot, "fake-bin");
  const callLogPath = join(repoRoot, "calls.jsonl");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(fakeBinDirectory, { recursive: true });
  copyFileSync(sourceScriptPath, join(scriptsDirectory, "process-dropbox.sh"));

  writeExecutable(
    join(fakeBinDirectory, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 09 ;;
  +%d) echo 30 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(fakeBinDirectory, command),
      `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(
  process.env.CALL_LOG,
  JSON.stringify({
    command: ${JSON.stringify(command)},
    args: process.argv.slice(2),
    cwd: process.cwd(),
  }) + "\\n",
);
`,
    );
  }

  return { repoRoot, dropboxDirectory, fakeBinDirectory, callLogPath };
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function writeDropboxFile(harness, fileName, contents = "Date,Description,Amount\n") {
  const filePath = join(harness.dropboxDirectory, fileName);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function runDropboxScript(harness, args = [], env = {}) {
  return spawnSync(
    "bash",
    [join(harness.repoRoot, "scripts/process-dropbox.sh"), ...args],
    {
      cwd: harness.repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${harness.fakeBinDirectory}:${process.env.PATH}`,
        CALL_LOG: harness.callLogPath,
        ...env,
      },
    },
  );
}

function readCalls(harness) {
  if (!existsSync(harness.callLogPath)) {
    return [];
  }

  return readFileSync(harness.callLogPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("Dropbox ingest refuses to run without a user id before side effects", async () => {
  const harness = await createHarness();
  const csvPath = writeDropboxFile(harness, "chase-activity.csv");

  const result = runDropboxScript(harness, ["--no-dataform"], {
    WAREHOUSE_IMPORT_USER_ID: "",
    WAREHOUSE_LANDING_BUCKET: "test-bucket",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /WAREHOUSE_IMPORT_USER_ID/);
  assert.deepEqual(readCalls(harness), []);
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry-run is allowed without a user id and does not mutate files", async () => {
  const harness = await createHarness();
  const csvPath = writeDropboxFile(harness, "discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"sourceAccountId":"discover"}\n');

  const result = runDropboxScript(harness, ["--dry-run"], {
    WAREHOUSE_IMPORT_USER_ID: "",
    WAREHOUSE_LANDING_BUCKET: "test-bucket",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /discover-export\.csv\s+->\s+discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.deepEqual(readCalls(harness), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("Dropbox ingest reads env-local defaults and passes the user id to the ETL runner", async () => {
  const harness = await createHarness();
  const csvPath = writeDropboxFile(harness, "capital_one-checking.csv");
  writeFileSync(`${csvPath}.context.json`, '{"sourceAccountId":"capital_one"}\n');
  writeFileSync(
    join(harness.repoRoot, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runDropboxScript(harness, ["--no-dataform"], {
    WAREHOUSE_IMPORT_USER_ID: "",
    WAREHOUSE_LANDING_BUCKET: "",
  });

  assert.equal(result.status, 0, result.stderr);

  const calls = readCalls(harness);
  assert.deepEqual(
    calls.map((call) => call.command),
    ["gcloud", "gcloud", "npm"],
  );
  assert.deepEqual(calls[0].args, [
    "storage",
    "cp",
    csvPath,
    "gs://env-bucket/incoming/capital_one/2026/09/30/capital_one-checking.csv",
  ]);
  assert.deepEqual(calls[1].args, [
    "storage",
    "cp",
    `${csvPath}.context.json`,
    "gs://env-bucket/incoming/capital_one/2026/09/30/capital_one-checking.csv.context.json",
  ]);
  assert.deepEqual(calls[2].args, [
    "run",
    "etl:runner",
    "--",
    "--gcs-bucket",
    "env-bucket",
    "--max-files",
    "50",
    "--user-id",
    "env-user",
  ]);
  assert.equal(calls[2].cwd, harness.repoRoot);
  assert.equal(existsSync(csvPath), false);
  assert.equal(
    existsSync(
      join(
        harness.dropboxDirectory,
        "_uploaded/2026-09-30/capital_one-checking.csv",
      ),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(
        harness.dropboxDirectory,
        "_uploaded/2026-09-30/capital_one-checking.csv.context.json",
      ),
    ),
    true,
  );
});

test("Dropbox ingest lets the CLI user id override env-local defaults", async () => {
  const harness = await createHarness();
  writeDropboxFile(harness, "manual-upload.csv");
  writeFileSync(
    join(harness.repoRoot, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runDropboxScript(
    harness,
    ["--no-dataform", "--user-id", "cli-user"],
    {
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
    },
  );

  assert.equal(result.status, 0, result.stderr);

  const npmCall = readCalls(harness).find((call) => call.command === "npm");
  assert.ok(npmCall);
  assert.deepEqual(npmCall.args.slice(-2), ["--user-id", "cli-user"]);
});
