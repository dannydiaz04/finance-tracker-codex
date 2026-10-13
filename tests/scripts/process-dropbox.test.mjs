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

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  copyFileSync(
    join(process.cwd(), "scripts/process-dropbox.sh"),
    join(scriptsDir, "process-dropbox.sh"),
  );

  const callLogPath = join(root, "calls.log");

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

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binDir, command),
      `#!/usr/bin/env bash
printf '%s\\n' "${command} $*" >> "$FAKE_CALL_LOG"
`,
    );
  }

  return { root, dropboxDir, binDir, callLogPath };
}

function runDropboxScript(sandbox, args = [], env = {}) {
  return spawnSync("bash", [join(sandbox.root, "scripts/process-dropbox.sh"), ...args], {
    cwd: sandbox.root,
    encoding: "utf8",
    env: {
      HOME: sandbox.root,
      PATH: `${sandbox.binDir}:${process.env.PATH}`,
      FAKE_CALL_LOG: sandbox.callLogPath,
      ...env,
    },
  });
}

function readCalls(sandbox) {
  return existsSync(sandbox.callLogPath)
    ? readFileSync(sandbox.callLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
}

test("Dropbox ingest refuses non-dry-run imports without a user id before side effects", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.deepEqual(readCalls(sandbox), []);
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry-run remains safe without credentials or a user id", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "discover-export.csv");
  writeFileSync(csvPath, "Trans. Date,Description,Amount\n04/13/2026,Book Shop,-18.99\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n');

  const result = runDropboxScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /discover-export\.csv  ->  discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.deepEqual(readCalls(sandbox), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("Dropbox ingest loads .env.local user and bucket defaults and archives uploaded files", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Chase Checking"}\n');
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
  );

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readCalls(sandbox), [
    `gcloud storage cp ${csvPath} gs://env-bucket/incoming/chase/2026/04/13/chase-activity.csv`,
    `gcloud storage cp ${csvPath}.context.json gs://env-bucket/incoming/chase/2026/04/13/chase-activity.csv.context.json`,
    "npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user",
  ]);
  assert.equal(
    existsSync(join(sandbox.dropboxDir, "_uploaded/2026-04-13/chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(join(sandbox.dropboxDir, "_uploaded/2026-04-13/chase-activity.csv.context.json")),
    true,
  );
  assert.equal(existsSync(csvPath), false);
});

test("Dropbox ingest lets --user-id override .env.local when invoking the ETL runner", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "manual.transactions.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Manual adjustment,10.00\n");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
  );

  const result = runDropboxScript(sandbox, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readCalls(sandbox), [
    `gcloud storage cp ${csvPath} gs://env-bucket/incoming/manual/2026/04/13/manual.transactions.csv`,
    "npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user",
  ]);
});
