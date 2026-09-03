import assert from "node:assert/strict";
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
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "dropbox"), { recursive: true });
  copyFileSync(sourceScript, scriptPath(root));
  chmodSync(scriptPath(root), 0o755);
  createCommandStubs(root);
  return root;
}

function scriptPath(root) {
  return join(root, "scripts", "process-dropbox.sh");
}

function binPath(root) {
  return join(root, "bin");
}

function callLogPath(root) {
  return join(root, "calls.log");
}

function createCommandStubs(root) {
  mkdirSync(binPath(root), { recursive: true });

  writeExecutable(
    root,
    "date",
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) exit 2 ;;
esac
`,
  );

  for (const name of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      root,
      name,
      `#!/usr/bin/env bash
{
  printf '${name}'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\\n'
} >> "$CALL_LOG"
`,
    );
  }
}

function writeExecutable(root, name, contents) {
  const target = join(binPath(root), name);
  writeFileSync(target, contents, "utf8");
  chmodSync(target, 0o755);
}

function scriptEnvironment(root, overrides = {}) {
  const env = {
    ...process.env,
    PATH: `${binPath(root)}:${process.env.PATH ?? ""}`,
    CALL_LOG: callLogPath(root),
  };

  for (const key of [
    "ETL_MAX_FILES",
    "WAREHOUSE_IMPORT_USER_ID",
    "WAREHOUSE_LANDING_BUCKET",
  ]) {
    delete env[key];
  }

  return { ...env, ...overrides };
}

function runScript(root, args = [], env = {}) {
  return spawnSync("bash", [scriptPath(root), ...args], {
    cwd: root,
    env: scriptEnvironment(root, env),
    encoding: "utf8",
    timeout: 10_000,
  });
}

function writeCsv(root, name = "chase-activity.csv") {
  const filePath = join(root, "dropbox", name);
  writeFileSync(
    filePath,
    "Date,Description,Amount\n2026-04-13,Coffee,4.50\n",
    "utf8",
  );
  return filePath;
}

function readCalls(root) {
  if (!existsSync(callLogPath(root))) {
    return [];
  }

  return readFileSync(callLogPath(root), "utf8")
    .split("\n")
    .filter(Boolean);
}

test("process-dropbox refuses real ingest without a user id before side effects", () => {
  const root = createWorkspace();
  const csvPath = writeCsv(root);

  const result = runScript(root);

  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.deepEqual(readCalls(root), []);
  assert.equal(existsSync(csvPath), true);
});

test("process-dropbox dry-run is allowed without a user id and avoids side effects", () => {
  const root = createWorkspace();
  const csvPath = writeCsv(root);
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Checking"}\n', "utf8");

  const result = runScript(root, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/chase\/2026\/04\/13\/chase-activity\.csv/,
  );
  assert.deepEqual(readCalls(root), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test("process-dropbox reads env-local user and bucket defaults for upload and runner", () => {
  const root = createWorkspace();
  const csvPath = writeCsv(root);
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Checking"}\n', "utf8");
  writeFileSync(
    join(root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const result = runScript(root, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readCalls(root), [
    `gcloud <storage> <cp> <${csvPath}> <gs://env-bucket/incoming/chase/2026/04/13/chase-activity.csv>`,
    `gcloud <storage> <cp> <${sidecarPath}> <gs://env-bucket/incoming/chase/2026/04/13/chase-activity.csv.context.json>`,
    "npm <run> <etl:runner> <--> <--gcs-bucket> <env-bucket> <--max-files> <50> <--user-id> <env-user-123>",
  ]);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(root, "dropbox", "_uploaded", "2026-04-13", "chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(root, "dropbox", "_uploaded", "2026-04-13", "chase-activity.csv.context.json"),
    ),
    true,
  );
});

test("process-dropbox CLI user id takes precedence over env-local default", () => {
  const root = createWorkspace();
  writeCsv(root);
  writeFileSync(
    join(root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runScript(root, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const runnerCall = readCalls(root).find((call) => call.startsWith("npm "));
  assert.equal(
    runnerCall,
    "npm <run> <etl:runner> <--> <--gcs-bucket> <env-bucket> <--max-files> <50> <--user-id> <cli-user>",
  );
});
