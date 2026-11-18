import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import test from "node:test";

const repoRoot = process.cwd();
const sourceScriptPath = join(repoRoot, "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const callsPath = join(root, "calls.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  copyFileSync(sourceScriptPath, join(scriptsDirectory, "process-dropbox.sh"));
  chmodSync(join(scriptsDirectory, "process-dropbox.sh"), 0o755);

  const stub = `#!/usr/bin/env bash
{
  printf '%s' "$(basename "$0")"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "\${CALL_LOG:?}"
`;
  writeExecutable(join(binDirectory, "gcloud"), stub);
  writeExecutable(join(binDirectory, "npm"), stub);
  writeExecutable(join(binDirectory, "npx"), stub);

  return { root, dropboxDirectory, binDirectory, callsPath };
}

function runDropboxScript(sandbox, args = [], env = {}) {
  return spawnSync("bash", ["scripts/process-dropbox.sh", ...args], {
    cwd: sandbox.root,
    encoding: "utf8",
    env: {
      ...process.env,
      CALL_LOG: sandbox.callsPath,
      ETL_MAX_FILES: "",
      PATH: `${sandbox.binDirectory}:${process.env.PATH}`,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
  });
}

function readCalls(sandbox) {
  return existsSync(sandbox.callsPath)
    ? readFileSync(sandbox.callsPath, "utf8")
    : "";
}

test("Dropbox ingest refuses real uploads without a user id before side effects", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(readCalls(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest dry runs remain safe without credentials or a user id", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "discover-export.csv");
  writeFileSync(csvPath, "Trans. Date,Description,Amount\n04/13/2026,Coffee,-4.50\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n');

  const result = runDropboxScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /discover-export\.csv  ->  discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(readCalls(sandbox), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest loads env defaults and forwards the env user id to the ETL runner", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    [
      "WAREHOUSE_IMPORT_USER_ID=env-user",
      'WAREHOUSE_LANDING_BUCKET="env-bucket"',
      "",
    ].join("\n"),
  );

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0);

  const calls = readCalls(sandbox);
  assert.match(calls, /gcloud\tstorage\tcp\t.*chase-activity\.csv\tgs:\/\/env-bucket\/incoming\/chase\//);
  assert.match(calls, /npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t50\t--user-id\tenv-user/);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), true);
});

test("Dropbox ingest CLI user id takes precedence over env defaults", () => {
  const sandbox = createSandbox();
  writeFileSync(
    join(sandbox.dropboxDirectory, "chase-activity.csv"),
    "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n",
  );
  writeFileSync(
    join(sandbox.root, ".env.local"),
    [
      "WAREHOUSE_IMPORT_USER_ID=env-user",
      "WAREHOUSE_LANDING_BUCKET=env-bucket",
      "",
    ].join("\n"),
  );

  const result = runDropboxScript(sandbox, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0);
  assert.match(readCalls(sandbox), /--user-id\tcli-user/);
  assert.doesNotMatch(readCalls(sandbox), /--user-id\tenv-user/);
});
