import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createProcessDropboxFixture(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const logDir = join(root, "logs");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  copyFileSync(
    join(process.cwd(), "scripts/process-dropbox.sh"),
    join(scriptsDir, "process-dropbox.sh"),
  );
  chmodSync(join(scriptsDir, "process-dropbox.sh"), 0o755);

  writeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "\${1:-}" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  writeExecutable(
    join(binDir, "gcloud"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${PROCESS_DROPBOX_TEST_LOG_DIR}/gcloud.log"
`,
  );
  writeExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${PROCESS_DROPBOX_TEST_LOG_DIR}/npm.log"
`,
  );
  writeExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "\${PROCESS_DROPBOX_TEST_LOG_DIR}/npx.log"
`,
  );

  t.after(() => rmSync(root, { recursive: true, force: true }));

  return {
    root,
    scriptsDir,
    dropboxDir,
    binDir,
    logDir,
    scriptPath: join(scriptsDir, "process-dropbox.sh"),
  };
}

function runProcessDropbox(fixture, args = [], env = {}) {
  return spawnSync(fixture.scriptPath, args, {
    cwd: fixture.root,
    encoding: "utf8",
    env: {
      HOME: fixture.root,
      PATH: `${fixture.binDir}:${process.env.PATH}`,
      PROCESS_DROPBOX_TEST_LOG_DIR: fixture.logDir,
      TMPDIR: tmpdir(),
      ...env,
    },
  });
}

function writeDropboxCsv(fixture, fileName = "chase-activity.csv") {
  const filePath = join(fixture.dropboxDir, fileName);
  writeFileSync(
    filePath,
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo\n04/13/2026,04/13/2026,Coffee,Food & Drink,Sale,-4.25,\n",
    "utf8",
  );
  return filePath;
}

function readLog(fixture, commandName) {
  const logPath = join(fixture.logDir, `${commandName}.log`);
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

test("process-dropbox refuses real ingest without a user id before side effects", (t) => {
  const fixture = createProcessDropboxFixture(t);
  const csvPath = writeDropboxCsv(fixture);

  const result = runProcessDropbox(fixture);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(readLog(fixture, "gcloud"), "");
  assert.equal(readLog(fixture, "npm"), "");
  assert.equal(readLog(fixture, "npx"), "");
  assert.equal(existsSync(csvPath), true);
});

test("process-dropbox dry run remains safe without a user id", (t) => {
  const fixture = createProcessDropboxFixture(t);
  const csvPath = writeDropboxCsv(fixture);
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{ "userId": "manifest-user" }\n', "utf8");

  const result = runProcessDropbox(fixture, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /chase-activity\.csv\s+->\s+chase/);
  assert.match(result.stdout, /\(\+ sidecar chase-activity\.csv\.context\.json\)/);
  assert.equal(readLog(fixture, "gcloud"), "");
  assert.equal(readLog(fixture, "npm"), "");
  assert.equal(readLog(fixture, "npx"), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test("process-dropbox reads user and bucket defaults from .env.local", (t) => {
  const fixture = createProcessDropboxFixture(t);
  const csvPath = writeDropboxCsv(fixture, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{ "sourceAccountId": "discover-card" }\n', "utf8");
  writeFileSync(
    join(fixture.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const result = runProcessDropbox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readLog(fixture, "gcloud"),
    /cp .*discover-export\.csv gs:\/\/env-bucket\/incoming\/discover\/2026\/04\/13\/discover-export\.csv/,
  );
  assert.match(
    readLog(fixture, "gcloud"),
    /cp .*discover-export\.csv\.context\.json gs:\/\/env-bucket\/incoming\/discover\/2026\/04\/13\/discover-export\.csv\.context\.json/,
  );
  assert.match(
    readLog(fixture, "npm"),
    /run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );
  assert.equal(readLog(fixture, "npx"), "");
  assert.equal(
    existsSync(join(fixture.dropboxDir, "_uploaded/2026-04-13/discover-export.csv")),
    true,
  );
  assert.equal(
    existsSync(join(fixture.dropboxDir, "_uploaded/2026-04-13/discover-export.csv.context.json")),
    true,
  );
});

test("process-dropbox gives CLI user id precedence over .env.local", (t) => {
  const fixture = createProcessDropboxFixture(t);
  writeDropboxCsv(fixture, "capital_one-checking.csv");
  writeFileSync(
    join(fixture.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runProcessDropbox(fixture, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ], {
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readLog(fixture, "npm"),
    /run etl:runner -- --gcs-bucket env-bucket --max-files 7 --user-id cli-user/,
  );
  assert.doesNotMatch(readLog(fixture, "npm"), /--user-id env-user/);
});
