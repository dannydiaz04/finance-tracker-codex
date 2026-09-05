import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const realScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");
const systemPath = "/usr/local/bin:/usr/bin:/bin";

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const callLogPath = join(root, "calls.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  writeFileSync(scriptPath, readFileSync(realScriptPath, "utf8"));
  chmodSync(scriptPath, 0o755);

  writeExecutable(
    join(binDirectory, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  writeLoggingCommand(join(binDirectory, "gcloud"), "gcloud");
  writeLoggingCommand(join(binDirectory, "npm"), "npm");
  writeLoggingCommand(join(binDirectory, "npx"), "npx");

  return {
    binDirectory,
    callLogPath,
    dropboxDirectory,
    root,
    scriptPath,
  };
}

function writeExecutable(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function writeLoggingCommand(path, name) {
  writeExecutable(
    path,
    `#!/usr/bin/env bash
{
  printf '${name}'
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$CALL_LOG"
`,
  );
}

function writeDropboxFile(sandbox, name, contents = "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n") {
  const filePath = join(sandbox.dropboxDirectory, name);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function runScript(sandbox, args = [], env = {}) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    encoding: "utf8",
    env: {
      PATH: `${sandbox.binDirectory}:${systemPath}`,
      CALL_LOG: sandbox.callLogPath,
      ...env,
    },
  });
}

function readCallLog(sandbox) {
  return existsSync(sandbox.callLogPath)
    ? readFileSync(sandbox.callLogPath, "utf8")
    : "";
}

test("Dropbox ingest refuses to process real uploads without a user id", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "discover-export.csv");

  const result = runScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.equal(readCallLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry-run remains side-effect free without a user id", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "chase-activity.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Checking"}\n', "utf8");

  const result = runScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/chase\/2026\/04\/13\/chase-activity\.csv/,
  );
  assert.equal(readCallLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test("Dropbox ingest loads env defaults, uploads sidecars, archives files, and forwards the user id", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountMask":"1234"}\n', "utf8");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const result = runScript(sandbox, ["--no-dataform"], { ETL_MAX_FILES: "7" });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner/);

  const callLog = readCallLog(sandbox);
  assert.match(
    callLog,
    /gcloud\tstorage\tcp\t.*capital_one-checking\.csv\tgs:\/\/env-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv/,
  );
  assert.match(
    callLog,
    /gcloud\tstorage\tcp\t.*capital_one-checking\.csv\.context\.json\tgs:\/\/env-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv\.context\.json/,
  );
  assert.match(
    callLog,
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t7\t--user-id\tenv-user/,
  );
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/capital_one-checking.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/capital_one-checking.csv.context.json"),
    ),
    true,
  );
});

test("Dropbox ingest CLI user id overrides the env-local default", () => {
  const sandbox = createSandbox();
  writeDropboxFile(sandbox, "manual.csv");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runScript(sandbox, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readCallLog(sandbox),
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t50\t--user-id\tcli-user/,
  );
});
