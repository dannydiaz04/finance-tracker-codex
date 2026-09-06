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
import { delimiter, join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeCommandStub(filePath, commandName) {
  writeFileSync(
    filePath,
    `#!/usr/bin/env bash
{
  printf '%s\\n' '${commandName}'
  for arg in "$@"; do
    printf '%s\\n' "$arg"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
`,
    "utf8",
  );
  chmodSync(filePath, 0o755);
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const binDirectory = join(root, "bin");
  const dropboxDirectory = join(root, "dropbox");
  const scriptsDirectory = join(root, "scripts");
  const commandLogPath = join(root, "commands.log");
  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");

  mkdirSync(binDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(scriptsDirectory, { recursive: true });
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeCommandStub(join(binDirectory, "gcloud"), "gcloud");
  writeCommandStub(join(binDirectory, "npm"), "npm");
  writeCommandStub(join(binDirectory, "npx"), "npx");

  t.after(() => rmSync(root, { recursive: true, force: true }));

  return {
    root,
    dropboxDirectory,
    commandLogPath,
    scriptPath,
    env: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      COMMAND_LOG: commandLogPath,
    },
  };
}

function runDropboxProcessor(harness, args = []) {
  const env = { ...harness.env };
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    env,
    encoding: "utf8",
  });
}

function writeDropboxCsv(harness, fileName = "discover-export.csv") {
  const filePath = join(harness.dropboxDirectory, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-01,Test,-1.23\n", "utf8");
  return filePath;
}

function readCommandLog(harness) {
  if (!existsSync(harness.commandLogPath)) {
    return [];
  }

  const rawLog = readFileSync(harness.commandLogPath, "utf8").trim();
  if (!rawLog) {
    return [];
  }

  return rawLog.split(/\n\n+/).map((commandBlock) => commandBlock.split("\n"));
}

test("Dropbox ingest refuses a real upload when no user id is configured", (t) => {
  const harness = createHarness(t);
  const filePath = writeDropboxCsv(harness);

  const result = runDropboxProcessor(harness);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.deepEqual(readCommandLog(harness), []);
  assert.equal(existsSync(filePath), true);
  assert.equal(existsSync(join(harness.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox dry runs remain safe without a configured user id", (t) => {
  const harness = createHarness(t);
  const filePath = writeDropboxCsv(harness);

  const result = runDropboxProcessor(harness, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /discover-export\.csv\s+->\s+discover/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.deepEqual(readCommandLog(harness), []);
  assert.equal(existsSync(filePath), true);
});

test("Dropbox ingest loads env defaults and forwards the user id to the runner", (t) => {
  const harness = createHarness(t);
  const filePath = writeDropboxCsv(harness);
  writeFileSync(`${filePath}.context.json`, '{"accountName":"Discover Card"}\n', "utf8");
  writeFileSync(
    join(harness.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const result = runDropboxProcessor(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /gs:\/\/env-bucket\/incoming\/discover\/\d{4}\/\d{2}\/\d{2}\/discover-export\.csv/,
  );

  const commands = readCommandLog(harness);
  assert.equal(commands.length, 3);
  assert.deepEqual(commands[0].slice(0, 3), ["gcloud", "storage", "cp"]);
  assert.equal(commands[0][3], filePath);
  assert.match(
    commands[0][4],
    /^gs:\/\/env-bucket\/incoming\/discover\/\d{4}\/\d{2}\/\d{2}\/discover-export\.csv$/,
  );
  assert.deepEqual(commands[1].slice(0, 4), [
    "gcloud",
    "storage",
    "cp",
    `${filePath}.context.json`,
  ]);
  assert.match(
    commands[1][4],
    /^gs:\/\/env-bucket\/incoming\/discover\/\d{4}\/\d{2}\/\d{2}\/discover-export\.csv\.context\.json$/,
  );
  assert.deepEqual(commands[2], [
    "npm",
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
  assert.equal(existsSync(filePath), false);
  assert.equal(existsSync(`${filePath}.context.json`), false);
  assert.equal(existsSync(join(harness.dropboxDirectory, "_uploaded")), true);
});

test("Dropbox ingest lets an explicit user id override .env.local", (t) => {
  const harness = createHarness(t);
  writeDropboxCsv(harness, "manual-export.csv");
  writeFileSync(
    join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runDropboxProcessor(harness, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);

  const npmCommand = readCommandLog(harness).at(-1);
  assert.deepEqual(npmCommand, [
    "npm",
    "run",
    "etl:runner",
    "--",
    "--gcs-bucket",
    "env-bucket",
    "--max-files",
    "50",
    "--user-id",
    "cli-user",
  ]);
});
