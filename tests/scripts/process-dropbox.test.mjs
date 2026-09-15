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

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const fakeBinDir = join(root, "fake-bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  copyFileSync(join(process.cwd(), "scripts/process-dropbox.sh"), scriptPath);
  chmodSync(scriptPath, 0o755);

  const gcloudLog = join(root, "gcloud.log");
  const npmLog = join(root, "npm.log");
  const npxLog = join(root, "npx.log");

  writeExecutable(
    join(fakeBinDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  writeExecutable(
    join(fakeBinDir, "gcloud"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GCLOUD_LOG"
`,
  );
  writeExecutable(
    join(fakeBinDir, "npm"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_NPM_LOG"
`,
  );
  writeExecutable(
    join(fakeBinDir, "npx"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_NPX_LOG"
`,
  );

  return {
    root,
    dropboxDir,
    fakeBinDir,
    gcloudLog,
    npmLog,
    npxLog,
    scriptPath,
  };
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o755 });
}

function writeDropboxCsv(sandbox, fileName = "chase-activity.csv") {
  const filePath = join(sandbox.dropboxDir, fileName);
  writeFileSync(filePath, "date,description,amount\n2026-04-13,Coffee,-4.25\n");
  return filePath;
}

function runDropboxScript(sandbox, args = [], env = {}) {
  const childEnv = {
    ...process.env,
    FAKE_GCLOUD_LOG: sandbox.gcloudLog,
    FAKE_NPM_LOG: sandbox.npmLog,
    FAKE_NPX_LOG: sandbox.npxLog,
    PATH: `${sandbox.fakeBinDir}:${process.env.PATH}`,
  };

  delete childEnv.WAREHOUSE_IMPORT_USER_ID;
  delete childEnv.WAREHOUSE_LANDING_BUCKET;
  delete childEnv.ETL_MAX_FILES;

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env: { ...childEnv, ...env },
    encoding: "utf8",
  });
}

function readLog(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

test("Dropbox ingest refuses to run without a user id before side effects", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox);

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(readLog(sandbox.gcloudLog), "");
  assert.equal(readLog(sandbox.npmLog), "");
  assert.equal(readLog(sandbox.npxLog), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox dry run previews files without requiring a user id", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Discover"}\n');

  const result = runDropboxScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /discover-export\.csv  ->  discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readLog(sandbox.gcloudLog), "");
  assert.equal(readLog(sandbox.npmLog), "");
  assert.equal(readLog(sandbox.npxLog), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test(".env.local supplies the ingest user id and landing bucket", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox, "chase-activity.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"sourceAccountId":"chase_card"}\n');
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET="env-bucket"\n',
  );

  const result = runDropboxScript(sandbox, ["--no-dataform"], {
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readLog(sandbox.gcloudLog),
    new RegExp(
      `storage cp ${escapeRegExp(csvPath)} gs://env-bucket/incoming/chase/2026/04/13/chase-activity\\.csv`,
    ),
  );
  assert.match(
    readLog(sandbox.gcloudLog),
    new RegExp(
      `storage cp ${escapeRegExp(sidecarPath)} gs://env-bucket/incoming/chase/2026/04/13/chase-activity\\.csv\\.context\\.json`,
    ),
  );
  assert.equal(
    readLog(sandbox.npmLog),
    "run etl:runner -- --gcs-bucket env-bucket --max-files 7 --user-id env-user\n",
  );
  assert.equal(readLog(sandbox.npxLog), "");
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(sandbox.dropboxDir, "_uploaded/2026-04-13/chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(join(sandbox.dropboxDir, "_uploaded/2026-04-13/chase-activity.csv.context.json")),
    true,
  );
});

test("CLI user id takes precedence over .env.local for the ETL runner", () => {
  const sandbox = createSandbox();
  writeDropboxCsv(sandbox, "manual-upload.csv");
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
    readLog(sandbox.npmLog),
    "run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user\n",
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
