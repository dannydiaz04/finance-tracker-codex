import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptPath = join(root, "scripts/process-dropbox.sh");
  const dropboxPath = join(root, "dropbox");
  const binPath = join(root, "bin");
  const commandLogPath = join(root, "commands.log");

  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(dropboxPath, { recursive: true });
  mkdirSync(binPath, { recursive: true });
  writeFileSync(scriptPath, readFileSync(sourceScriptPath, "utf8"), "utf8");
  chmodSync(scriptPath, 0o755);

  writeExecutable(
    join(binPath, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binPath, command),
      `#!/usr/bin/env bash
printf '${command}' >> "$COMMAND_LOG"
printf '|%s' "$@" >> "$COMMAND_LOG"
printf '\\n' >> "$COMMAND_LOG"
`,
    );
  }

  return {
    root,
    scriptPath,
    dropboxPath,
    binPath,
    commandLogPath,
  };
}

function runProcessDropbox(sandbox, args = [], env = {}) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${sandbox.binPath}:${process.env.PATH}`,
      COMMAND_LOG: sandbox.commandLogPath,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
  });
}

function writeDropboxFile(sandbox, fileName, contents = "Date,Description,Amount\n2026-04-01,Coffee,-5.00\n") {
  const path = join(sandbox.dropboxPath, fileName);
  writeFileSync(path, contents, "utf8");
  return path;
}

function readCommandLog(sandbox) {
  return existsSync(sandbox.commandLogPath)
    ? readFileSync(sandbox.commandLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
}

test("refuses real Dropbox ingest without a user id before side effects", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "discover-export.csv");

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /WAREHOUSE_IMPORT_USER_ID/);
  assert.deepEqual(readCommandLog(sandbox), []);
  assert.equal(existsSync(csvPath), true);
});

test("allows dry runs without a user id and leaves files untouched", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "apple_card-export.csv");
  const contextPath = `${csvPath}.context.json`;
  writeFileSync(contextPath, JSON.stringify({ sourceAccountId: "apple_card" }), "utf8");

  const result = runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Found 1 file\(s\) in dropbox/);
  assert.match(result.stdout, /\(\+ sidecar apple_card-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.deepEqual(readCommandLog(sandbox), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(contextPath), true);
});

test("loads .env.local user and bucket defaults for upload and runner", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "discover-export.csv");
  const contextPath = `${csvPath}.context.json`;
  writeFileSync(contextPath, JSON.stringify({ sourceAccountId: "discover_card" }), "utf8");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0);
  assert.deepEqual(readCommandLog(sandbox), [
    `gcloud|storage|cp|${csvPath}|gs://env-bucket/incoming/discover/2026/04/13/${basename(csvPath)}`,
    `gcloud|storage|cp|${contextPath}|gs://env-bucket/incoming/discover/2026/04/13/${basename(csvPath)}.context.json`,
    "npm|run|etl:runner|--|--gcs-bucket|env-bucket|--max-files|50|--user-id|env-user",
  ]);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(contextPath), false);
  assert.equal(
    existsSync(join(sandbox.dropboxPath, "_uploaded/2026-04-13", basename(csvPath))),
    true,
  );
  assert.equal(
    existsSync(join(sandbox.dropboxPath, "_uploaded/2026-04-13", basename(contextPath))),
    true,
  );
});

test("prefers CLI user id over .env.local when invoking the runner", () => {
  const sandbox = createSandbox();
  writeDropboxFile(sandbox, "chase-export.csv");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runProcessDropbox(sandbox, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0);
  assert.ok(
    readCommandLog(sandbox).includes(
      "npm|run|etl:runner|--|--gcs-bucket|env-bucket|--max-files|50|--user-id|cli-user",
    ),
  );
});
