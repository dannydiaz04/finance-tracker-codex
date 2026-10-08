import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function createScriptHarness() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const callLog = join(root, "calls.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  writeFileSync(scriptPath, readFileSync(sourceScriptPath, "utf8"), "utf8");
  chmodSync(scriptPath, 0o755);

  writeCommandStub(binDirectory, "gcloud");
  writeCommandStub(binDirectory, "npm");
  writeCommandStub(binDirectory, "npx");

  return { root, dropboxDirectory, binDirectory, callLog, scriptPath };
}

function writeCommandStub(binDirectory, commandName) {
  const commandPath = join(binDirectory, commandName);
  writeFileSync(
    commandPath,
    `#!/usr/bin/env bash\nprintf '${commandName}' >> "$CALL_LOG"\nprintf ' %s' "$@" >> "$CALL_LOG"\nprintf '\\n' >> "$CALL_LOG"\n`,
    "utf8",
  );
  chmodSync(commandPath, 0o755);
}

function runScript(harness, args = [], envOverrides = {}) {
  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${harness.binDirectory}:${process.env.PATH ?? ""}`,
      CALL_LOG: harness.callLog,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...envOverrides,
    },
  });
}

function commandLog(harness) {
  if (!existsSync(harness.callLog)) {
    return "";
  }

  return readFileSync(harness.callLog, "utf8");
}

function writeDropboxFile(harness, fileName, contents = "date,description,amount\n2026-04-01,Coffee,4.50\n") {
  const filePath = join(harness.dropboxDirectory, fileName);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function uploadedArchiveFiles(harness) {
  const uploadedDirectory = join(harness.dropboxDirectory, "_uploaded");
  if (!existsSync(uploadedDirectory)) {
    return [];
  }

  return readdirSync(uploadedDirectory, { recursive: true })
    .filter((entry) => statSync(join(uploadedDirectory, entry.toString())).isFile())
    .map((entry) => basename(entry.toString()));
}

test("Dropbox ingest refuses real uploads without a user id before side effects", () => {
  const harness = createScriptHarness();
  const csvPath = writeDropboxFile(harness, "chase-activity.csv");

  const result = runScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(commandLog(harness), "");
  assert.ok(existsSync(csvPath), "CSV should remain in the active dropbox");
  assert.deepEqual(uploadedArchiveFiles(harness), []);
});

test("Dropbox dry runs work without credentials or user id and leave files in place", () => {
  const harness = createScriptHarness();
  const csvPath = writeDropboxFile(harness, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Discover"}\n', "utf8");

  const result = runScript(harness, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /discover-export\.csv  ->  discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(commandLog(harness), "");
  assert.ok(existsSync(csvPath), "dry run should not move the CSV");
  assert.ok(existsSync(sidecarPath), "dry run should not move the sidecar");
  assert.deepEqual(uploadedArchiveFiles(harness), []);
});

test(".env.local user and bucket defaults are forwarded to the ETL runner", () => {
  const harness = createScriptHarness();
  const csvPath = writeDropboxFile(harness, "capital_one-checking.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountMask":"5980"}\n', "utf8");
  writeFileSync(
    join(harness.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=\'test-landing-bucket\'\n',
    "utf8",
  );

  const result = runScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  const log = commandLog(harness);
  assert.match(
    log,
    /gcloud storage cp .*capital_one-checking\.csv gs:\/\/test-landing-bucket\/incoming\/capital_one\//,
  );
  assert.match(
    log,
    /gcloud storage cp .*capital_one-checking\.csv\.context\.json gs:\/\/test-landing-bucket\/incoming\/capital_one\/.*\.context\.json/,
  );
  assert.match(
    log,
    /npm run etl:runner -- --gcs-bucket test-landing-bucket --max-files 50 --user-id env-user-123/,
  );
  assert.doesNotMatch(log, /^npx /m);
  assert.deepEqual(uploadedArchiveFiles(harness).sort(), [
    "capital_one-checking.csv",
    "capital_one-checking.csv.context.json",
  ]);
});

test("--user-id overrides .env.local when invoking the ETL runner", () => {
  const harness = createScriptHarness();
  writeDropboxFile(harness, "manual-upload.csv");
  writeFileSync(
    join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user-123\n",
    "utf8",
  );

  const result = runScript(harness, ["--no-dataform", "--user-id", "cli-user-456"]);

  assert.equal(result.status, 0, result.stderr);
  const log = commandLog(harness);
  assert.match(log, /npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 50 --user-id cli-user-456/);
  assert.doesNotMatch(log, /env-user-123/);
});
