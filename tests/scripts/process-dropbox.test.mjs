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
import { delimiter, join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const scriptSource = join(repoRoot, "scripts/process-dropbox.sh");

function writeFakeExecutable(path) {
  writeFileSync(
    path,
    `#!/usr/bin/env bash
printf '%s' "$(basename "$0")" >> "$CALL_LOG"
for arg in "$@"; do
  printf '\\t%s' "$arg" >> "$CALL_LOG"
done
printf '\\n' >> "$CALL_LOG"
`,
    "utf8",
  );
  chmodSync(path, 0o755);
}

function createSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(scriptSource, scriptPath);
  chmodSync(scriptPath, 0o755);

  for (const command of ["gcloud", "npm", "npx"]) {
    writeFakeExecutable(join(binDirectory, command));
  }

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  return {
    root,
    scriptPath,
    dropboxDirectory,
    binDirectory,
    callLogPath: join(root, "calls.log"),
  };
}

function runScript(sandbox, args = [], envOverrides = {}) {
  const env = {
    ...process.env,
    PATH: `${sandbox.binDirectory}${delimiter}${process.env.PATH ?? ""}`,
    CALL_LOG: sandbox.callLogPath,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  Object.assign(env, envOverrides);

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env,
    encoding: "utf8",
  });
}

function readCalls(sandbox) {
  if (!existsSync(sandbox.callLogPath)) {
    return [];
  }

  return readFileSync(sandbox.callLogPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

function writeDropboxFile(sandbox, fileName, contents = "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n") {
  const filePath = join(sandbox.dropboxDirectory, fileName);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function uploadedFileNames(sandbox) {
  const uploadedDirectory = join(sandbox.dropboxDirectory, "_uploaded");
  if (!existsSync(uploadedDirectory)) {
    return [];
  }

  return readdirSync(uploadedDirectory).flatMap((dayDirectory) =>
    readdirSync(join(uploadedDirectory, dayDirectory)),
  );
}

test("process-dropbox refuses a real ingest without a user id before side effects", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeDropboxFile(sandbox, "chase-activity.csv");

  const result = runScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.deepEqual(readCalls(sandbox), []);
  assert.equal(existsSync(csvPath), true);
  assert.deepEqual(uploadedFileNames(sandbox), []);
});

test("process-dropbox dry run stays side-effect free without a user id", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeDropboxFile(sandbox, "discover-export.csv");
  const contextPath = `${csvPath}.context.json`;
  writeFileSync(contextPath, '{"accountName":"Discover"}\n', "utf8");

  const result = runScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.deepEqual(readCalls(sandbox), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(contextPath), true);
  assert.deepEqual(uploadedFileNames(sandbox), []);
});

test("process-dropbox loads .env.local user and bucket before upload and ETL", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeDropboxFile(sandbox, "capital_one-checking.csv");
  const contextPath = `${csvPath}.context.json`;

  writeFileSync(contextPath, '{"accountName":"Capital One 360"}\n', "utf8");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="app-user-42"\nWAREHOUSE_LANDING_BUCKET=\'custom-bucket\'\n',
    "utf8",
  );

  const result = runScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);

  const calls = readCalls(sandbox);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].slice(0, 4), ["gcloud", "storage", "cp", csvPath]);
  assert.match(
    calls[0][4],
    /^gs:\/\/custom-bucket\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv$/,
  );
  assert.deepEqual(calls[1], [
    "gcloud",
    "storage",
    "cp",
    contextPath,
    `${calls[0][4]}.context.json`,
  ]);
  assert.deepEqual(calls[2], [
    "npm",
    "run",
    "etl:runner",
    "--",
    "--gcs-bucket",
    "custom-bucket",
    "--max-files",
    "50",
    "--user-id",
    "app-user-42",
  ]);

  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(contextPath), false);
  assert.deepEqual(uploadedFileNames(sandbox).sort(), [
    "capital_one-checking.csv",
    "capital_one-checking.csv.context.json",
  ]);
});
