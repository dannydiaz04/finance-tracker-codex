import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptSourcePath = join(process.cwd(), "scripts/process-dropbox.sh");

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const fakeBinDirectory = join(root, "fake-bin");
  const commandLogDirectory = join(root, "command-log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(fakeBinDirectory, { recursive: true });
  mkdirSync(commandLogDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(scriptSourcePath, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeFakeCommand(
    fakeBinDirectory,
    "gcloud",
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_COMMAND_LOG/gcloud.log"
exit 0
`,
  );
  writeFakeCommand(
    fakeBinDirectory,
    "npm",
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_COMMAND_LOG/npm.log"
exit 0
`,
  );
  writeFakeCommand(
    fakeBinDirectory,
    "npx",
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_COMMAND_LOG/npx.log"
exit 0
`,
  );

  return {
    root,
    scriptPath,
    dropboxDirectory,
    fakeBinDirectory,
    commandLogDirectory,
  };
}

function writeFakeCommand(directory, name, contents) {
  const commandPath = join(directory, name);
  writeFileSync(commandPath, contents, "utf8");
  chmodSync(commandPath, 0o755);
}

function writeDropboxCsv(sandbox, fileName = "discover-export.csv") {
  const filePath = join(sandbox.dropboxDirectory, fileName);
  writeFileSync(filePath, "date,description,amount\n2026-04-13,Coffee,4.25\n", "utf8");
  return filePath;
}

function runProcessDropbox(sandbox, args = [], envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  Object.assign(env, envOverrides, {
    FAKE_COMMAND_LOG: sandbox.commandLogDirectory,
    PATH: `${sandbox.fakeBinDirectory}:${process.env.PATH}`,
  });

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env,
    encoding: "utf8",
  });
}

function readCommandLog(sandbox, commandName) {
  const logPath = join(sandbox.commandLogDirectory, `${commandName}.log`);
  if (!existsSync(logPath)) {
    return [];
  }

  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
}

function listFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(path));
    } else {
      files.push(path);
    }
  }

  return files;
}

test("Dropbox ingest refuses real processing without a user id before side effects", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox);

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(existsSync(csvPath), true);
  assert.deepEqual(readCommandLog(sandbox, "gcloud"), []);
  assert.deepEqual(readCommandLog(sandbox, "npm"), []);
  assert.deepEqual(readCommandLog(sandbox, "npx"), []);
});

test("Dropbox ingest dry-run remains safe without a user id", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox, "capital_one-checking.csv");
  writeFileSync(`${csvPath}.context.json`, '{"sourceAccountId":"checking"}\n', "utf8");

  const result = runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Found 1 file\(s\) in dropbox/);
  assert.match(result.stdout, /\(\+ sidecar capital_one-checking\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
  assert.deepEqual(readCommandLog(sandbox, "gcloud"), []);
  assert.deepEqual(readCommandLog(sandbox, "npm"), []);
  assert.deepEqual(readCommandLog(sandbox, "npx"), []);
});

test("Dropbox ingest loads .env.local user and bucket defaults before upload and runner", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox, "chase-activity.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"sourceAccountId":"chase_card"}\n', "utf8");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'custom-bucket\'\n',
    "utf8",
  );

  const result = runProcessDropbox(sandbox, ["--no-dataform"], {
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bucket: gs:\/\/custom-bucket/);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);

  const gcloudCommands = readCommandLog(sandbox, "gcloud");
  assert.equal(gcloudCommands.length, 2);
  assert.match(
    gcloudCommands[0],
    /storage cp .*\/dropbox\/chase-activity\.csv gs:\/\/custom-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
  );
  assert.match(
    gcloudCommands[1],
    /storage cp .*\/dropbox\/chase-activity\.csv\.context\.json gs:\/\/custom-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv\.context\.json/,
  );
  assert.deepEqual(readCommandLog(sandbox, "npm"), [
    "run etl:runner -- --gcs-bucket custom-bucket --max-files 7 --user-id env-user",
  ]);
  assert.deepEqual(readCommandLog(sandbox, "npx"), []);

  const archivedNames = listFiles(join(sandbox.dropboxDirectory, "_uploaded")).map(
    (filePath) => basename(filePath),
  );
  assert.deepEqual(archivedNames.sort(), [
    "chase-activity.csv",
    "chase-activity.csv.context.json",
  ]);
});

test("Dropbox ingest CLI user id overrides .env.local user id", () => {
  const sandbox = createSandbox();
  writeDropboxCsv(sandbox, "discover-export.csv");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runProcessDropbox(sandbox, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readCommandLog(sandbox, "npm"), [
    "run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user",
  ]);
});
