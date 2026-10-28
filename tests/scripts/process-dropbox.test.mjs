import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixtureDate = {
  year: "2026",
  month: "04",
  day: "13",
};

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const callLogPath = join(root, "calls.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const sourceScript = readFileSync(
    join(process.cwd(), "scripts/process-dropbox.sh"),
    "utf8",
  );
  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  writeFileSync(scriptPath, sourceScript, { mode: 0o755 });

  writeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash
log_call "gcloud" "$@"
`,
  );
  writeExecutable(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash
log_call "npm" "$@"
`,
  );
  writeExecutable(
    join(binDirectory, "npx"),
    `#!/usr/bin/env bash
log_call "npx" "$@"
`,
  );
  writeExecutable(
    join(binDirectory, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo "${fixtureDate.year}" ;;
  +%m) echo "${fixtureDate.month}" ;;
  +%d) echo "${fixtureDate.day}" ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  writeExecutable(
    join(binDirectory, "log_call"),
    `#!/usr/bin/env bash
{
  printf '%s' "$1"
  shift
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$CALL_LOG"
`,
  );

  function run(args = [], env = {}) {
    return spawnSync("bash", [scriptPath, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...withoutWarehouseEnv(process.env),
        CALL_LOG: callLogPath,
        PATH: `${binDirectory}:${process.env.PATH}`,
        ...env,
      },
    });
  }

  return {
    root,
    dropboxDirectory,
    callLogPath,
    run,
  };
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function withoutWarehouseEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("WAREHOUSE_")),
  );
}

function writeCsv(dropboxDirectory, fileName = "chase-export.csv") {
  const csvPath = join(dropboxDirectory, fileName);
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");
  return csvPath;
}

function readCalls(callLogPath) {
  if (!existsSync(callLogPath)) {
    return [];
  }
  return readFileSync(callLogPath, "utf8").trim().split("\n").filter(Boolean);
}

test("process-dropbox refuses real ingest without a user id before side effects", () => {
  const harness = createHarness();
  const csvPath = writeCsv(harness.dropboxDirectory);

  const result = harness.run(["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.deepEqual(readCalls(harness.callLogPath), []);
  assert.equal(existsSync(csvPath), true);
});

test("process-dropbox dry run remains safe without credentials or a user id", () => {
  const harness = createHarness();
  const csvPath = writeCsv(harness.dropboxDirectory, "discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n');

  const result = harness.run(["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.deepEqual(readCalls(harness.callLogPath), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("process-dropbox loads user and bucket defaults from .env.local for ingest", () => {
  const harness = createHarness();
  const csvPath = writeCsv(harness.dropboxDirectory, "chase-activity.csv");
  writeFileSync(`${csvPath}.context.json`, '{"sourceAccountId":"chase_card"}\n');
  writeFileSync(
    join(harness.root, ".env.local"),
    [
      'WAREHOUSE_IMPORT_USER_ID="user-from-env"',
      "WAREHOUSE_LANDING_BUCKET='bucket-from-env'",
      "",
    ].join("\n"),
  );

  const result = harness.run(["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readCalls(harness.callLogPath), [
    [
      "gcloud",
      "storage",
      "cp",
      csvPath,
      "gs://bucket-from-env/incoming/chase/2026/04/13/chase-activity.csv",
    ].join("\t"),
    [
      "gcloud",
      "storage",
      "cp",
      `${csvPath}.context.json`,
      "gs://bucket-from-env/incoming/chase/2026/04/13/chase-activity.csv.context.json",
    ].join("\t"),
    [
      "npm",
      "run",
      "etl:runner",
      "--",
      "--gcs-bucket",
      "bucket-from-env",
      "--max-files",
      "50",
      "--user-id",
      "user-from-env",
    ].join("\t"),
  ]);
  assert.equal(existsSync(csvPath), false);
  assert.equal(
    existsSync(join(harness.dropboxDirectory, "_uploaded/2026-04-13/chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(harness.dropboxDirectory, "_uploaded/2026-04-13/chase-activity.csv.context.json"),
    ),
    true,
  );
});

test("process-dropbox lets --user-id override .env.local", () => {
  const harness = createHarness();
  writeCsv(harness.dropboxDirectory, "capital_one-checking.csv");
  writeFileSync(
    join(harness.root, ".env.local"),
    [
      "WAREHOUSE_IMPORT_USER_ID=user-from-env",
      "WAREHOUSE_LANDING_BUCKET=bucket-from-env",
      "",
    ].join("\n"),
  );

  const result = harness.run(["--no-dataform", "--user-id", "user-from-cli"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readCalls(harness.callLogPath).at(-1),
    [
      "npm",
      "run",
      "etl:runner",
      "--",
      "--gcs-bucket",
      "bucket-from-env",
      "--max-files",
      "50",
      "--user-id",
      "user-from-cli",
    ].join("\t"),
  );
});
