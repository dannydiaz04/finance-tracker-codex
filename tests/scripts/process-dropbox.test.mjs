import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeExecutable(
    join(binDirectory, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 10 ;;
  +%d) echo 18 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  writeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_COMMAND_LOG_DIR/gcloud.log"
exit 0
`,
  );

  writeExecutable(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_COMMAND_LOG_DIR/npm.log"
exit 0
`,
  );

  writeExecutable(
    join(binDirectory, "npx"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_COMMAND_LOG_DIR/npx.log"
exit 0
`,
  );

  return { root, scriptPath, dropboxDirectory, binDirectory };
}

function runScript(harness, args, envOverrides = {}) {
  const logDirectory = join(harness.root, "command-log");
  mkdirSync(logDirectory, { recursive: true });

  const env = {
    ...process.env,
    ...envOverrides,
    FAKE_COMMAND_LOG_DIR: logDirectory,
    PATH: `${harness.binDirectory}:${process.env.PATH}`,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;
  Object.assign(env, envOverrides);

  return {
    ...spawnSync("bash", [harness.scriptPath, ...args], {
      cwd: harness.root,
      env,
      encoding: "utf8",
    }),
    logDirectory,
  };
}

function readLog(result, fileName) {
  const path = join(result.logDirectory, fileName);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function writeDropboxFile(harness, fileName, contents = "Date,Description,Amount\n2026-10-18,Test,1.23\n") {
  const path = join(harness.dropboxDirectory, fileName);
  writeFileSync(path, contents, "utf8");
  return path;
}

test("process-dropbox refuses real ingest without a user id before side effects", (t) => {
  const harness = createHarness(t);
  const csvPath = writeDropboxFile(harness, "discover-export.csv");

  const result = runScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readLog(result, "gcloud.log"), "");
  assert.equal(readLog(result, "npm.log"), "");
  assert.equal(existsSync(csvPath), true);
});

test("process-dropbox dry-run remains safe without credentials or a user id", (t) => {
  const harness = createHarness(t);
  const csvPath = writeDropboxFile(harness, "apple_card-may.csv");
  const contextPath = `${csvPath}.context.json`;
  writeFileSync(contextPath, '{"accountName":"Apple Card"}\n', "utf8");

  const result = runScript(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /apple_card-may\.csv\s+->\s+apple_card/);
  assert.match(result.stdout, /\(\+ sidecar apple_card-may\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readLog(result, "gcloud.log"), "");
  assert.equal(readLog(result, "npm.log"), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(contextPath), true);
});

test("process-dropbox loads env defaults, uploads sidecars, archives files, and forwards user id", (t) => {
  const harness = createHarness(t);
  const csvPath = writeDropboxFile(harness, "chase-activity.csv");
  const contextPath = `${csvPath}.context.json`;
  writeFileSync(contextPath, '{"sourceAccountId":"chase-checking"}\n', "utf8");
  writeFileSync(
    join(harness.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readLog(result, "gcloud.log"),
    /storage cp .*chase-activity\.csv gs:\/\/env-bucket\/incoming\/chase\/2026\/10\/18\/chase-activity\.csv/,
  );
  assert.match(
    readLog(result, "gcloud.log"),
    /storage cp .*chase-activity\.csv\.context\.json gs:\/\/env-bucket\/incoming\/chase\/2026\/10\/18\/chase-activity\.csv\.context\.json/,
  );
  assert.match(
    readLog(result, "npm.log"),
    /run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(contextPath), false);
  assert.equal(
    existsSync(join(harness.dropboxDirectory, "_uploaded", "2026-10-18", "chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(join(harness.dropboxDirectory, "_uploaded", "2026-10-18", "chase-activity.csv.context.json")),
    true,
  );
});

test("process-dropbox lets --user-id override the env-local import user", (t) => {
  const harness = createHarness(t);
  writeDropboxFile(harness, "capital_one-checking.csv");
  writeFileSync(
    join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runScript(harness, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr);
  const npmLog = readLog(result, "npm.log");
  assert.match(npmLog, /--user-id cli-user/);
  assert.doesNotMatch(npmLog, /env-user/);
});
