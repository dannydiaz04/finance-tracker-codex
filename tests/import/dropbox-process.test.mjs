import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function createSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const binDirectory = join(root, "bin");
  const dropboxDirectory = join(root, "dropbox");
  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  t.after(() => rmSync(root, { recursive: true, force: true }));

  return { root, binDirectory, dropboxDirectory, scriptPath };
}

function installFakeCommand(binDirectory, name, body) {
  const executablePath = join(binDirectory, name);

  writeFileSync(
    executablePath,
    `#!/usr/bin/env bash
set -euo pipefail
${body}
`,
    "utf8",
  );
  chmodSync(executablePath, 0o755);
}

function runProcessDropbox(sandbox, args = [], env = {}) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env: {
      HOME: sandbox.root,
      PATH: process.env.PATH ?? "",
      ...env,
    },
    encoding: "utf8",
  });
}

test("process-dropbox refuses real ingest when no user id is configured", (t) => {
  const sandbox = createSandbox(t);

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
});

test("process-dropbox forwards an explicit user id to the landed import runner", (t) => {
  const sandbox = createSandbox(t);
  const npmArgsPath = join(sandbox.root, "npm-args.txt");
  const gcloudLogPath = join(sandbox.root, "gcloud.log");

  writeFileSync(
    join(sandbox.dropboxDirectory, "discover-export.csv"),
    "Date,Description,Amount\n2026-01-01,Coffee,-4.50\n",
    "utf8",
  );
  installFakeCommand(
    sandbox.binDirectory,
    "gcloud",
    `printf '%s\\n' "$*" >> ${JSON.stringify(gcloudLogPath)}`,
  );
  installFakeCommand(
    sandbox.binDirectory,
    "npm",
    `printf '%s\\n' "$@" > ${JSON.stringify(npmArgsPath)}`,
  );

  const result = runProcessDropbox(
    sandbox,
    ["--no-dataform", "--user-id", "user-123"],
    {
      ETL_MAX_FILES: "7",
      PATH: `${sandbox.binDirectory}:${process.env.PATH ?? ""}`,
      WAREHOUSE_LANDING_BUCKET: "unit-test-bucket",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readFileSync(npmArgsPath, "utf8").trim().split("\n"), [
    "run",
    "etl:runner",
    "--",
    "--gcs-bucket",
    "unit-test-bucket",
    "--max-files",
    "7",
    "--user-id",
    "user-123",
  ]);
  assert.match(
    readFileSync(gcloudLogPath, "utf8"),
    /storage cp .*discover-export\.csv gs:\/\/unit-test-bucket\/incoming\/discover\//,
  );
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "discover-export.csv")), false);
});

test("process-dropbox uses .env.local user and bucket defaults for real ingest", (t) => {
  const sandbox = createSandbox(t);
  const npmArgsPath = join(sandbox.root, "npm-args.txt");

  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );
  writeFileSync(
    join(sandbox.dropboxDirectory, "manual-upload.csv"),
    "Date,Description,Amount\n2026-01-01,Coffee,-4.50\n",
    "utf8",
  );
  installFakeCommand(sandbox.binDirectory, "gcloud", "exit 0");
  installFakeCommand(
    sandbox.binDirectory,
    "npm",
    `printf '%s\\n' "$@" > ${JSON.stringify(npmArgsPath)}`,
  );

  const result = runProcessDropbox(sandbox, ["--no-dataform"], {
    ETL_MAX_FILES: "3",
    PATH: `${sandbox.binDirectory}:${process.env.PATH ?? ""}`,
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readFileSync(npmArgsPath, "utf8").trim().split("\n"), [
    "run",
    "etl:runner",
    "--",
    "--gcs-bucket",
    "env-bucket",
    "--max-files",
    "3",
    "--user-id",
    "env-user",
  ]);
});
