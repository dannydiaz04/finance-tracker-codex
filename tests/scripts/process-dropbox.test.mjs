import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function createScriptSandbox() {
  const repoRoot = mkdtemp("finance-tracker-dropbox-");
  const scriptsDirectory = join(repoRoot, "scripts");
  const dropboxDirectory = join(repoRoot, "dropbox");
  const binDirectory = join(repoRoot, "bin");
  const callLogPath = join(repoRoot, "calls.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts/process-dropbox.sh"),
    join(scriptsDirectory, "process-dropbox.sh"),
  );
  chmodSync(join(scriptsDirectory, "process-dropbox.sh"), 0o755);

  writeStub(binDirectory, "gcloud", "gcloud");
  writeStub(binDirectory, "npm", "npm");
  writeStub(binDirectory, "npx", "npx");
  writeDateStub(binDirectory);

  const env = {
    ...process.env,
    CALL_LOG: callLogPath,
    PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
  };
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  return {
    repoRoot,
    dropboxDirectory,
    callLogPath,
    env,
    scriptPath: join(scriptsDirectory, "process-dropbox.sh"),
  };
}

function mkdtemp(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeStub(binDirectory, fileName, label) {
  const stubPath = join(binDirectory, fileName);
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
printf '%s\\n' '${label} '"$*" >> "$CALL_LOG"
`,
    "utf8",
  );
  chmodSync(stubPath, 0o755);
}

function writeDateStub(binDirectory) {
  const stubPath = join(binDirectory, "date");
  writeFileSync(
    stubPath,
    `#!/usr/bin/env bash
case "$1" in
  +%Y) printf '2026\\n' ;;
  +%m) printf '04\\n' ;;
  +%d) printf '13\\n' ;;
  *) /bin/date "$@" ;;
esac
`,
    "utf8",
  );
  chmodSync(stubPath, 0o755);
}

function runProcessDropbox(sandbox, args = [], envOverrides = {}) {
  const env = {
    ...sandbox.env,
    ...envOverrides,
  };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (typeof value === "undefined") {
      delete env[key];
    }
  }

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.repoRoot,
    env,
    encoding: "utf8",
  });
}

function readCallLog(sandbox) {
  return existsSync(sandbox.callLogPath)
    ? readFileSync(sandbox.callLogPath, "utf8")
    : "";
}

test("Dropbox ingest refuses a real run without a user id before side effects", () => {
  const sandbox = createScriptSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.equal(readCallLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest dry-run remains available without a user id", () => {
  const sandbox = createScriptSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "discover-export.csv");
  writeFileSync(csvPath, "Trans. Date,Description,Amount\n04/13/2026,Coffee,-4.50\n", "utf8");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

  const result = runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /discover-export\.csv\s+->\s+discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCallLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest loads .env.local defaults and stamps ETL imports with the user id", () => {
  const sandbox = createScriptSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "capital_one-checking.csv");
  writeFileSync(csvPath, "Transaction Date,Description,Debit,Credit\n04/13/2026,Coffee,4.50,\n", "utf8");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Checking"}\n', "utf8");
  writeFileSync(
    join(sandbox.repoRoot, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=custom-landing-bucket\n',
    "utf8",
  );

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  const callLog = readCallLog(sandbox);
  assert.match(
    callLog,
    /gcloud storage cp .*capital_one-checking\.csv gs:\/\/custom-landing-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv/,
  );
  assert.match(
    callLog,
    /gcloud storage cp .*capital_one-checking\.csv\.context\.json gs:\/\/custom-landing-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv\.context\.json/,
  );
  assert.match(
    callLog,
    /npm run etl:runner -- --gcs-bucket custom-landing-bucket --max-files 50 --user-id env-user-123/,
  );
  assert.equal(existsSync(csvPath), false);
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/capital_one-checking.csv")),
    true,
  );
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/capital_one-checking.csv.context.json")),
    true,
  );
});

test("Dropbox ingest lets --user-id override environment and .env.local defaults", () => {
  const sandbox = createScriptSandbox();
  writeFileSync(
    join(sandbox.dropboxDirectory, "manual.csv"),
    "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n",
    "utf8",
  );
  writeFileSync(
    join(sandbox.repoRoot, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=file-user\n",
    "utf8",
  );

  const result = runProcessDropbox(
    sandbox,
    ["--no-dataform", "--user-id", "cli-user"],
    {
      WAREHOUSE_IMPORT_USER_ID: "env-user",
      ETL_MAX_FILES: "7",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readCallLog(sandbox),
    /npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 7 --user-id cli-user/,
  );
});
