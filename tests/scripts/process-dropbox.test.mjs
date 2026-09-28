import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(repoRoot, "scripts");
  const dropboxDirectory = join(repoRoot, "dropbox");
  const binDirectory = join(repoRoot, "bin");
  const callsLogPath = join(repoRoot, "calls.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binDirectory, command),
      `#!/usr/bin/env bash
printf '%s' "$(basename "$0")" >> "$CALLS_LOG"
printf '\\t%s' "$@" >> "$CALLS_LOG"
printf '\\n' >> "$CALLS_LOG"
exit 0
`,
    );
  }

  return { repoRoot, dropboxDirectory, binDirectory, callsLogPath, scriptPath };
}

function runProcessDropBox(sandbox, args = [], envOverrides = {}) {
  const env = { ...process.env, ...envOverrides };
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  Object.assign(env, envOverrides);

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.repoRoot,
    env: {
      ...env,
      CALLS_LOG: sandbox.callsLogPath,
      PATH: `${sandbox.binDirectory}:${env.PATH}`,
    },
    encoding: "utf8",
  });
}

function readCalls(callsLogPath) {
  if (!existsSync(callsLogPath)) {
    return [];
  }

  const contents = readFileSync(callsLogPath, "utf8").trim();
  if (!contents) {
    return [];
  }

  return contents.split("\n").map((line) => {
    const [command, ...args] = line.split("\t");
    return { command, args };
  });
}

function collectRelativeFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const results = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else {
        results.push(relative(root, path));
      }
    }
  }

  visit(root);
  return results;
}

test("process-dropbox refuses real ingest without a user id before side effects", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "discover-export.csv");
  writeFileSync(
    csvPath,
    "Date,Description,Amount\n2026-04-01,Coffee,-4.25\n",
    "utf8",
  );

  const result = runProcessDropBox(sandbox);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.deepEqual(readCalls(sandbox.callsLogPath), []);
  assert.equal(existsSync(csvPath), true);
  assert.deepEqual(
    collectRelativeFiles(join(sandbox.dropboxDirectory, "_uploaded")),
    [],
  );
});

test("process-dropbox dry run allows missing user id without moving or uploading files", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "chase-activity.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(
    csvPath,
    "Transaction Date,Description,Amount\n04/01/2026,Coffee,-4.25\n",
    "utf8",
  );
  writeFileSync(sidecarPath, "{}\n", "utf8");

  const result = runProcessDropBox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run complete/);
  assert.deepEqual(readCalls(sandbox.callsLogPath), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test("process-dropbox loads .env.local defaults, uploads sidecars, and archives files", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(
    csvPath,
    "Transaction Date,Description,Amount\n04/01/2026,Coffee,-4.25\n",
    "utf8",
  );
  writeFileSync(sidecarPath, '{"accountName":"Capital One Checking"}\n', "utf8");
  writeFileSync(
    join(sandbox.repoRoot, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET="env-bucket"\n',
    "utf8",
  );

  const result = runProcessDropBox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);

  const calls = readCalls(sandbox.callsLogPath);
  const gcloudCalls = calls.filter((call) => call.command === "gcloud");
  assert.equal(gcloudCalls.length, 2);
  assert.deepEqual(gcloudCalls[0].args.slice(0, 3), ["storage", "cp", csvPath]);
  assert.match(
    gcloudCalls[0].args[3],
    /^gs:\/\/env-bucket\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv$/,
  );
  assert.deepEqual(gcloudCalls[1].args.slice(0, 3), [
    "storage",
    "cp",
    sidecarPath,
  ]);
  assert.equal(gcloudCalls[1].args[3], `${gcloudCalls[0].args[3]}.context.json`);

  const npmCall = calls.find((call) => call.command === "npm");
  assert.deepEqual(npmCall?.args, [
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
  assert.equal(calls.some((call) => call.command === "npx"), false);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  const archivedFiles = collectRelativeFiles(
    join(sandbox.dropboxDirectory, "_uploaded"),
  );
  assert.equal(archivedFiles.length, 2);
  assert.ok(archivedFiles.some((file) => file.endsWith("capital_one-checking.csv")));
  assert.ok(
    archivedFiles.some((file) =>
      file.endsWith("capital_one-checking.csv.context.json"),
    ),
  );
});

test("process-dropbox gives command-line user id precedence over .env.local", () => {
  const sandbox = createSandbox();
  writeFileSync(
    join(sandbox.dropboxDirectory, "manual-transactions.csv"),
    "Date,Description,Amount\n2026-04-01,Coffee,-4.25\n",
    "utf8",
  );
  writeFileSync(
    join(sandbox.repoRoot, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runProcessDropBox(sandbox, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const npmCall = readCalls(sandbox.callsLogPath).find(
    (call) => call.command === "npm",
  );
  assert.deepEqual(npmCall?.args.slice(-2), ["--user-id", "cli-user"]);
});
