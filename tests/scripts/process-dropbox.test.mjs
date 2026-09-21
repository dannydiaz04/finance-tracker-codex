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
import { dirname, join } from "node:path";
import test from "node:test";

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function createHarness() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(repoRoot, "scripts");
  const dropboxDir = join(repoRoot, "dropbox");
  const fakeBinDir = join(repoRoot, "fake-bin");
  const callLog = join(repoRoot, "calls.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  copyFileSync(sourceScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeFakeCommand(fakeBinDir, "gcloud", "gcloud");
  writeFakeCommand(fakeBinDir, "npm", "npm");
  writeFakeCommand(fakeBinDir, "npx", "npx");

  return { repoRoot, dropboxDir, fakeBinDir, callLog, scriptPath };
}

function writeFakeCommand(fakeBinDir, commandName, logName) {
  const commandPath = join(fakeBinDir, commandName);
  writeFileSync(
    commandPath,
    `#!/usr/bin/env bash
printf '%s\\t%s\\n' '${logName}' "$*" >> "$FAKE_CALL_LOG"
exit 0
`,
    "utf8",
  );
  chmodSync(commandPath, 0o755);
}

function runDropboxScript(harness, args = [], envOverrides = {}) {
  const env = {
    ...process.env,
    PATH: `${harness.fakeBinDir}:${process.env.PATH}`,
    FAKE_CALL_LOG: harness.callLog,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return spawnSync(harness.scriptPath, args, {
    cwd: harness.repoRoot,
    env,
    encoding: "utf8",
  });
}

function readCallLog(harness) {
  return existsSync(harness.callLog)
    ? readFileSync(harness.callLog, "utf8")
    : "";
}

function writeDropboxFile(harness, relativePath, contents = "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n") {
  const filePath = join(harness.dropboxDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

test("Dropbox ingest refuses real uploads without a user id before side effects", () => {
  const harness = createHarness();
  const csvPath = writeDropboxFile(harness, "chase-activity.csv");

  const result = runDropboxScript(harness);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(readCallLog(harness), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry-run is safe without a user id", () => {
  const harness = createHarness();
  const csvPath = writeDropboxFile(harness, "Discover-AllAvailable.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Discover"}\n', "utf8");

  const result = runDropboxScript(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Discover-AllAvailable\.csv\s+->\s+discover/);
  assert.match(result.stdout, /\(\+ sidecar Discover-AllAvailable\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCallLog(harness), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test(".env.local user and bucket defaults are used for upload and runner", () => {
  const harness = createHarness();
  const csvPath = writeDropboxFile(harness, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"userId":"context-user"}\n', "utf8");
  writeFileSync(
    join(harness.repoRoot, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runDropboxScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const log = readCallLog(harness);
  assert.match(
    log,
    /gcloud\tstorage cp .*capital_one-checking\.csv gs:\/\/env-bucket\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv/,
  );
  assert.match(
    log,
    /gcloud\tstorage cp .*capital_one-checking\.csv\.context\.json gs:\/\/env-bucket\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv\.context\.json/,
  );
  assert.match(
    log,
    /npm\trun etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );
  assert.doesNotMatch(log, /^npx\t/m);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(harness.dropboxDir, "_uploaded", archivedDate(), "capital_one-checking.csv")),
    true,
  );
  assert.equal(
    existsSync(join(harness.dropboxDir, "_uploaded", archivedDate(), "capital_one-checking.csv.context.json")),
    true,
  );
});

test("--user-id overrides .env.local when invoking the ETL runner", () => {
  const harness = createHarness();
  writeDropboxFile(harness, "manual.csv");
  writeFileSync(
    join(harness.repoRoot, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runDropboxScript(harness, ["--no-dataform", "--user-id", "cli-user"], {
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    readCallLog(harness),
    /npm\trun etl:runner -- --gcs-bucket env-bucket --max-files 7 --user-id cli-user/,
  );
});

function archivedDate() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
