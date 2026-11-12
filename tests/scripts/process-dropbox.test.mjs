import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const sourceScript = join(repoRoot, "scripts", "process-dropbox.sh");

function makeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function readLog(root, name) {
  const path = join(root, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function createHarness(envLocal = "") {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  copyFileSync(sourceScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  if (envLocal) {
    writeFileSync(join(root, ".env.local"), envLocal, "utf8");
  }

  makeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  makeExecutable(
    join(binDir, "gcloud"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG_DIR/gcloud.log"
`,
  );
  makeExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG_DIR/npm.log"
`,
  );
  makeExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG_DIR/npx.log"
`,
  );

  return { root, scriptPath, dropboxDir, binDir };
}

function writeDropboxCsv(harness, fileName) {
  const path = join(harness.dropboxDir, fileName);
  writeFileSync(path, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");
  return path;
}

function runDropbox(harness, args = []) {
  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    env: {
      ...process.env,
      PATH: `${harness.binDir}:${process.env.PATH ?? ""}`,
      TEST_LOG_DIR: harness.root,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ETL_MAX_FILES: "",
    },
    encoding: "utf8",
  });
}

test("process-dropbox refuses real ingest without a user id before side effects", () => {
  const harness = createHarness();
  const csvPath = writeDropboxCsv(harness, "chase-activity.csv");

  const result = runDropbox(harness, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readLog(harness.root, "gcloud.log"), "");
  assert.equal(readLog(harness.root, "npm.log"), "");
  assert.equal(readLog(harness.root, "npx.log"), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(harness.dropboxDir, "_uploaded")), false);
});

test("process-dropbox dry-run stays safe without credentials or user id", () => {
  const harness = createHarness();
  const csvPath = writeDropboxCsv(harness, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Discover"}\n', "utf8");

  const result = runDropbox(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.equal(readLog(harness.root, "gcloud.log"), "");
  assert.equal(readLog(harness.root, "npm.log"), "");
  assert.equal(readLog(harness.root, "npx.log"), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test("process-dropbox uses .env.local user and bucket defaults for ingest", () => {
  const harness = createHarness(`WAREHOUSE_IMPORT_USER_ID="env-user-42"
WAREHOUSE_LANDING_BUCKET='env-bucket'
`);
  const csvPath = writeDropboxCsv(harness, "apple_card-april.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"sourceAccountId":"apple-card"}\n', "utf8");

  const result = runDropbox(harness, ["--no-dataform"]);

  assert.equal(result.status, 0);
  assert.equal(
    readLog(harness.root, "gcloud.log"),
    [
      `storage cp ${csvPath} gs://env-bucket/incoming/apple_card/2026/04/13/apple_card-april.csv`,
      `storage cp ${sidecarPath} gs://env-bucket/incoming/apple_card/2026/04/13/apple_card-april.csv.context.json`,
      "",
    ].join("\n"),
  );
  assert.equal(
    readLog(harness.root, "npm.log"),
    "run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user-42\n",
  );
  assert.equal(readLog(harness.root, "npx.log"), "");
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(harness.dropboxDir, "_uploaded", "2026-04-13", "apple_card-april.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(harness.dropboxDir, "_uploaded", "2026-04-13", "apple_card-april.csv.context.json"),
    ),
    true,
  );
});

test("process-dropbox lets an explicit user id override .env.local", () => {
  const harness = createHarness(`WAREHOUSE_IMPORT_USER_ID=env-user-42
WAREHOUSE_LANDING_BUCKET=env-bucket
`);
  writeDropboxCsv(harness, "capital_one-checking.csv");

  const result = runDropbox(harness, ["--no-dataform", "--user-id", "cli-user-99"]);

  assert.equal(result.status, 0);
  assert.equal(
    readLog(harness.root, "npm.log"),
    "run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user-99\n",
  );
});
