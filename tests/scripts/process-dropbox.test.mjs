import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const commandLog = join(root, "commands.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  cpSync(sourceScriptPath, scriptPath);

  writeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  for (const commandName of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binDir, commandName),
      `#!/usr/bin/env bash
{
  printf '${commandName}'
  for arg in "$@"; do
    printf ' %s' "$arg"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
`,
    );
  }

  return {
    root,
    scriptPath,
    dropboxDir,
    commandLog,
    binDir,
  };
}

function runProcessDropbox(harness, args = [], extraEnv = {}) {
  const env = {
    ...process.env,
    PATH: `${harness.binDir}:${process.env.PATH}`,
    COMMAND_LOG: harness.commandLog,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;
  Object.assign(env, extraEnv);

  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    env,
    encoding: "utf8",
  });
}

function readCommandLog(harness) {
  return existsSync(harness.commandLog)
    ? readFileSync(harness.commandLog, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
    : [];
}

test("Dropbox ingest refuses real processing without a user id before side effects", () => {
  const harness = createHarness();
  const csvPath = join(harness.dropboxDir, "chase-feed.csv");
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n", "utf8");

  const result = runProcessDropbox(harness);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(existsSync(csvPath), true);
  assert.deepEqual(readCommandLog(harness), []);
});

test("Dropbox ingest dry-runs without a user id and leaves files in place", () => {
  const harness = createHarness();
  const csvPath = join(harness.dropboxDir, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n", "utf8");
  writeFileSync(sidecarPath, '{"accountName":"Checking"}\n', "utf8");

  const result = runProcessDropbox(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv/,
  );
  assert.match(result.stdout, /\(\+ sidecar capital_one-checking\.csv\.context\.json\)/);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
  assert.deepEqual(readCommandLog(harness), []);
});

test(".env.local supplies the ingest user and landing bucket for upload and runner", () => {
  const harness = createHarness();
  const csvPath = join(harness.dropboxDir, "chase-feed.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n", "utf8");
  writeFileSync(sidecarPath, '{"accountName":"Chase"}\n', "utf8");
  writeFileSync(
    join(harness.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const result = runProcessDropbox(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readCommandLog(harness), [
    `gcloud storage cp ${csvPath} gs://env-bucket/incoming/chase/2026/04/13/chase-feed.csv`,
    `gcloud storage cp ${sidecarPath} gs://env-bucket/incoming/chase/2026/04/13/chase-feed.csv.context.json`,
    "npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user",
  ]);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(harness.dropboxDir, "_uploaded/2026-04-13/chase-feed.csv")),
    true,
  );
  assert.equal(
    existsSync(join(harness.dropboxDir, "_uploaded/2026-04-13/chase-feed.csv.context.json")),
    true,
  );
});

test("--user-id overrides .env.local when invoking the ETL runner", () => {
  const harness = createHarness();
  writeFileSync(
    join(harness.dropboxDir, "discover-feed.csv"),
    "Transaction Date,Description,Amount\n",
    "utf8",
  );
  writeFileSync(
    join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runProcessDropbox(harness, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const npmCommand = readCommandLog(harness).find((line) => line.startsWith("npm "));
  assert.equal(
    npmCommand,
    "npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user",
  );
});
