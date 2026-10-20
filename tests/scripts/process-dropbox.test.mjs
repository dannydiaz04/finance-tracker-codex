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

const scriptUnderTest = join(process.cwd(), "scripts/process-dropbox.sh");

function createExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const logDir = join(root, "logs");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  cpSync(scriptUnderTest, scriptPath);
  chmodSync(scriptPath, 0o755);

  createExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  createExecutable(
    join(binDir, "gcloud"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG_DIR/gcloud.log"
`,
  );
  createExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG_DIR/npm.log"
`,
  );
  createExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_LOG_DIR/npx.log"
`,
  );

  return { root, dropboxDir, logDir, binDir, scriptPath };
}

function runDropboxScript(sandbox, args = [], envOverrides = {}) {
  const env = {
    ...process.env,
    PATH: `${sandbox.binDir}:${process.env.PATH}`,
    TEST_LOG_DIR: sandbox.logDir,
    ...envOverrides,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;

  Object.assign(env, envOverrides);

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env,
    encoding: "utf8",
  });
}

function readLog(sandbox, name) {
  const path = join(sandbox.logDir, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

test("Dropbox ingest refuses non-dry-run processing before side effects when no user id is configured", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n");

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readLog(sandbox, "gcloud.log"), "");
  assert.equal(readLog(sandbox, "npm.log"), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry-run remains safe without credentials or user id", () => {
  const sandbox = createSandbox();
  writeFileSync(
    join(sandbox.dropboxDir, "discover-export.csv"),
    "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n",
  );

  const result = runDropboxScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/discover\/2026\/04\/13\/discover-export\.csv/,
  );
  assert.equal(readLog(sandbox, "gcloud.log"), "");
  assert.equal(readLog(sandbox, "npm.log"), "");
});

test(".env.local user and bucket defaults are used for upload and ETL runner scope", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "american_express-april.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Amex"}\n');
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET="env-bucket"\n',
  );

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readLog(sandbox, "gcloud.log"),
    /storage cp .*american_express-april\.csv gs:\/\/env-bucket\/incoming\/american_express\/2026\/04\/13\/american_express-april\.csv/,
  );
  assert.match(
    readLog(sandbox, "gcloud.log"),
    /storage cp .*american_express-april\.csv\.context\.json gs:\/\/env-bucket\/incoming\/american_express\/2026\/04\/13\/american_express-april\.csv\.context\.json/,
  );
  assert.equal(
    readLog(sandbox, "npm.log"),
    "run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user\n",
  );
  assert.equal(
    existsSync(
      join(
        sandbox.dropboxDir,
        "_uploaded/2026-04-13/american_express-april.csv",
      ),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(
        sandbox.dropboxDir,
        "_uploaded/2026-04-13/american_express-april.csv.context.json",
      ),
    ),
    true,
  );
});

test("CLI user id overrides .env.local when forwarding to the ETL runner", () => {
  const sandbox = createSandbox();
  writeFileSync(
    join(sandbox.dropboxDir, "capital_one-checking.csv"),
    "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n",
  );
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
  assert.equal(
    readLog(sandbox, "npm.log"),
    "run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user\n",
  );
});
