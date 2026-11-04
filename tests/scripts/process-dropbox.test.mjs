import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function createSandbox({ envLocal } = {}) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const commandLogPath = join(root, "commands.log");
  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeFakeCommand(binDirectory, "gcloud");
  writeFakeCommand(binDirectory, "npm");
  writeFakeCommand(binDirectory, "npx");

  if (envLocal) {
    writeFileSync(join(root, ".env.local"), envLocal, "utf8");
  }

  const env = {
    ...process.env,
    COMMAND_LOG: commandLogPath,
    PATH: `${binDirectory}:${process.env.PATH}`,
  };
  delete env.ETL_MAX_FILES;
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;

  return {
    root,
    dropboxDirectory,
    scriptPath,
    commandLogPath,
    env,
  };
}

function writeFakeCommand(binDirectory, name) {
  const commandPath = join(binDirectory, name);
  writeFileSync(
    commandPath,
    `#!/usr/bin/env bash
{
  printf '${name}'
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
`,
    "utf8",
  );
  chmodSync(commandPath, 0o755);
}

function writeCsv(sandbox, fileName = "chase-activity.csv") {
  const csvPath = join(sandbox.dropboxDirectory, fileName);
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");
  return csvPath;
}

function writeSidecar(csvPath) {
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Checking"}\n', "utf8");
}

function runDropboxScript(sandbox, args = [], extraEnv = {}) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env: { ...sandbox.env, ...extraEnv },
    encoding: "utf8",
  });
}

function readCommandLog(sandbox) {
  if (!existsSync(sandbox.commandLogPath)) {
    return [];
  }

  return readFileSync(sandbox.commandLogPath, "utf8").trim().split("\n").filter(Boolean);
}

function listRelativeFiles(directory) {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { recursive: true })
    .filter((entry) => statSync(join(directory, entry)).isFile())
    .map((entry) => relative(directory, join(directory, entry)).replaceAll("\\", "/"))
    .sort();
}

test("dropbox ingest refuses non-dry-run processing without a user id before side effects", () => {
  const sandbox = createSandbox();
  writeCsv(sandbox);

  const result = runDropboxScript(sandbox);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.deepEqual(readCommandLog(sandbox), []);
  assert.deepEqual(listRelativeFiles(sandbox.dropboxDirectory), ["chase-activity.csv"]);
});

test("dropbox dry run remains safe without credentials or a user id", () => {
  const sandbox = createSandbox();
  const csvPath = writeCsv(sandbox);
  writeSidecar(csvPath);

  const result = runDropboxScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
  );
  assert.match(result.stdout, /\(\+ sidecar chase-activity\.csv\.context\.json\)/);
  assert.deepEqual(readCommandLog(sandbox), []);
  assert.deepEqual(listRelativeFiles(sandbox.dropboxDirectory), [
    "chase-activity.csv",
    "chase-activity.csv.context.json",
  ]);
});

test("dropbox ingest loads .env.local defaults and forwards the import user to the ETL runner", () => {
  const sandbox = createSandbox({
    envLocal: [
      'WAREHOUSE_IMPORT_USER_ID="env-user"',
      "WAREHOUSE_LANDING_BUCKET='env-bucket'",
      "",
    ].join("\n"),
  });
  const csvPath = writeCsv(sandbox);
  writeSidecar(csvPath);

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  const commands = readCommandLog(sandbox);
  assert.equal(commands.length, 3);
  assert.match(
    commands[0],
    /^gcloud\tstorage\tcp\t.+\/chase-activity\.csv\tgs:\/\/env-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv$/,
  );
  assert.match(
    commands[1],
    /^gcloud\tstorage\tcp\t.+\/chase-activity\.csv\.context\.json\tgs:\/\/env-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv\.context\.json$/,
  );
  assert.equal(
    commands[2],
    "npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t50\t--user-id\tenv-user",
  );
  const archivedFiles = listRelativeFiles(sandbox.dropboxDirectory);
  assert.equal(archivedFiles.length, 2);
  assert.match(
    archivedFiles[0],
    /_uploaded\/\d{4}-\d{2}-\d{2}\/chase-activity\.csv$/,
  );
  assert.match(
    archivedFiles[1],
    /_uploaded\/\d{4}-\d{2}-\d{2}\/chase-activity\.csv\.context\.json$/,
  );
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "chase-activity.csv")), false);
});

test("dropbox ingest prefers an explicit CLI user id over the .env.local fallback", () => {
  const sandbox = createSandbox({
    envLocal: [
      "WAREHOUSE_IMPORT_USER_ID=env-user",
      "WAREHOUSE_LANDING_BUCKET=env-bucket",
      "",
    ].join("\n"),
  });
  writeCsv(sandbox, "discover-export.csv");

  const result = runDropboxScript(sandbox, ["--no-dataform", "--user-id", "cli-user"], {
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    readCommandLog(sandbox).includes(
      "npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t7\t--user-id\tcli-user",
    ),
  );
});
