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
import { basename, join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const processDropboxScript = join(repoRoot, "scripts/process-dropbox.sh");

function createSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-dropbox-script-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(processDropboxScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  const callLogPath = join(root, "calls.jsonl");
  const shim = [
    "#!/usr/bin/env node",
    'const { appendFileSync } = require("node:fs");',
    'const { basename } = require("node:path");',
    "appendFileSync(process.env.CALL_LOG_PATH, JSON.stringify({ bin: basename(process.argv[1]), args: process.argv.slice(2) }) + \"\\n\");",
    "",
  ].join("\n");

  for (const binary of ["gcloud", "npm", "npx"]) {
    const shimPath = join(binDirectory, binary);
    writeFileSync(shimPath, shim, "utf8");
    chmodSync(shimPath, 0o755);
  }

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  return {
    binDirectory,
    callLogPath,
    dropboxDirectory,
    root,
    scriptPath,
  };
}

function runScript(sandbox, args = [], envOverrides = {}) {
  const env = {
    ...process.env,
    CALL_LOG_PATH: sandbox.callLogPath,
    HOME: sandbox.root,
    PATH: `${sandbox.binDirectory}:${process.env.PATH}`,
  };

  for (const key of [
    "ETL_MAX_FILES",
    "WAREHOUSE_IMPORT_USER_ID",
    "WAREHOUSE_LANDING_BUCKET",
  ]) {
    delete env[key];
  }

  Object.assign(env, envOverrides);

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    encoding: "utf8",
    env,
  });
}

function readCalls(sandbox) {
  if (!existsSync(sandbox.callLogPath)) {
    return [];
  }

  return readFileSync(sandbox.callLogPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeCsv(dropboxDirectory, fileName) {
  const csvPath = join(dropboxDirectory, fileName);
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");
  return csvPath;
}

test("Dropbox ingest refuses non-dry-run processing without a user id before side effects", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeCsv(sandbox.dropboxDirectory, "chase-activity.csv");

  const result = runScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.deepEqual(readCalls(sandbox), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest dry-run remains safe without credentials or a user id", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeCsv(sandbox.dropboxDirectory, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"sourceAccountId":"discover_card"}\n', "utf8");

  const result = runScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /discover-export\.csv\s+->\s+discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.deepEqual(readCalls(sandbox), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test("Dropbox ingest loads .env.local defaults and forwards user id to the ETL runner", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeCsv(sandbox.dropboxDirectory, "capital_one-checking.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Capital One 360"}\n', "utf8");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const result = runScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);

  const calls = readCalls(sandbox);
  assert.equal(calls.length, 3);

  const [csvUpload, sidecarUpload, runner] = calls;
  assert.equal(csvUpload.bin, "gcloud");
  assert.deepEqual(csvUpload.args.slice(0, 2), ["storage", "cp"]);
  assert.equal(csvUpload.args[2], csvPath);
  assert.match(
    csvUpload.args[3],
    /^gs:\/\/env-bucket\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv$/,
  );

  assert.equal(sidecarUpload.bin, "gcloud");
  assert.equal(sidecarUpload.args[2], `${csvPath}.context.json`);
  assert.equal(sidecarUpload.args[3], `${csvUpload.args[3]}.context.json`);

  assert.equal(runner.bin, "npm");
  assert.deepEqual(runner.args, [
    "run",
    "etl:runner",
    "--",
    "--gcs-bucket",
    "env-bucket",
    "--max-files",
    "50",
    "--user-id",
    "env-user-123",
  ]);

  const uploadDates = readdirSync(join(sandbox.dropboxDirectory, "_uploaded"));
  assert.equal(uploadDates.length, 1);
  const archivedDirectory = join(sandbox.dropboxDirectory, "_uploaded", uploadDates[0]);
  assert.equal(existsSync(join(archivedDirectory, basename(csvPath))), true);
  assert.equal(existsSync(join(archivedDirectory, `${basename(csvPath)}.context.json`)), true);
});
