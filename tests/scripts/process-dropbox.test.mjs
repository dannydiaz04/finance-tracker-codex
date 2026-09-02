import assert from "node:assert/strict";
import {
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

const repoRoot = process.cwd();
const scriptSource = readFileSync(
  join(repoRoot, "scripts/process-dropbox.sh"),
  "utf8",
);

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, { mode: 0o755 });
}

function createSandbox(envLocal = "") {
  const root = mkdtempSync(join(tmpdir(), "finance-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  writeExecutable(join(scriptsDirectory, "process-dropbox.sh"), scriptSource);

  if (envLocal) {
    writeFileSync(join(root, ".env.local"), envLocal, "utf8");
  }

  writeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$COMMAND_LOG_DIR/gcloud.log"
`,
  );
  writeExecutable(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$COMMAND_LOG_DIR/npm.log"
`,
  );
  writeExecutable(
    join(binDirectory, "npx"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$COMMAND_LOG_DIR/npx.log"
`,
  );

  return { root, dropboxDirectory, binDirectory };
}

function runDropboxScript(sandbox, args, envOverrides = {}) {
  const env = {
    ...process.env,
    PATH: `${sandbox.binDirectory}:${process.env.PATH}`,
    COMMAND_LOG_DIR: sandbox.root,
    WAREHOUSE_IMPORT_USER_ID: "",
    WAREHOUSE_LANDING_BUCKET: "",
    ...envOverrides,
  };

  return spawnSync(
    "bash",
    [join(sandbox.root, "scripts/process-dropbox.sh"), ...args],
    {
      cwd: sandbox.root,
      env,
      encoding: "utf8",
    },
  );
}

function writeCsv(sandbox, fileName = "chase-activity.csv") {
  const filePath = join(sandbox.dropboxDirectory, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-01-02,Coffee,-4.25\n", "utf8");
  return filePath;
}

function readLog(sandbox, logName) {
  const logPath = join(sandbox.root, logName);
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

test("real Dropbox ingest refuses to run without a user id", () => {
  const sandbox = createSandbox();
  const csvPath = writeCsv(sandbox);

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(readLog(sandbox, "gcloud.log"), "");
  assert.equal(readLog(sandbox, "npm.log"), "");
  assert.equal(existsSync(csvPath), true);
});

test("dry-run Dropbox ingest does not require a user id or touch files", () => {
  const sandbox = createSandbox();
  const csvPath = writeCsv(sandbox, "discover-export.csv");

  const result = runDropboxScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(readLog(sandbox, "gcloud.log"), "");
  assert.equal(readLog(sandbox, "npm.log"), "");
  assert.equal(existsSync(csvPath), true);
});

test(".env.local supplies the import user and landing bucket for real ingest", () => {
  const sandbox = createSandbox(`WAREHOUSE_IMPORT_USER_ID="app-user-123"
WAREHOUSE_LANDING_BUCKET='custom-finance-landing'
`);
  const csvPath = writeCsv(sandbox, "capital_one-checking.csv");

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    readLog(sandbox, "gcloud.log"),
    /^storage cp .*capital_one-checking\.csv gs:\/\/custom-finance-landing\/incoming\/capital_one\//m,
  );
  assert.match(
    readLog(sandbox, "npm.log"),
    /run etl:runner -- --gcs-bucket custom-finance-landing --max-files 50 --user-id app-user-123/,
  );
  assert.equal(existsSync(csvPath), false);
});

test("--user-id overrides .env.local when forwarding ETL runner arguments", () => {
  const sandbox = createSandbox(`WAREHOUSE_IMPORT_USER_ID=env-user
WAREHOUSE_LANDING_BUCKET=env-bucket
`);
  writeCsv(sandbox, "apple_card-april.csv");

  const result = runDropboxScript(sandbox, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    readLog(sandbox, "npm.log"),
    /run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user/,
  );
});
