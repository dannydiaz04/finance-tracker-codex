import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-process-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const logDir = join(root, "logs");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });
  copyFileSync(sourceScript, join(scriptsDir, "process-dropbox.sh"));

  writeExecutable(
    join(binDir, "gcloud"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$TEST_LOG_DIR/gcloud.log\"\n",
  );
  writeExecutable(
    join(binDir, "npm"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$TEST_LOG_DIR/npm.log\"\n",
  );
  writeExecutable(
    join(binDir, "npx"),
    "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$TEST_LOG_DIR/npx.log\"\n",
  );

  return {
    root,
    dropboxDir,
    logDir,
    scriptPath: join(scriptsDir, "process-dropbox.sh"),
    env: {
      HOME: root,
      LC_ALL: "C",
      PATH: `${binDir}:${process.env.PATH}`,
      TEST_LOG_DIR: logDir,
      TZ: "UTC",
    },
  };
}

function runScript(sandbox, args = [], envOverrides = {}) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    encoding: "utf8",
    env: {
      ...sandbox.env,
      ...envOverrides,
    },
  });
}

function writeDropboxFile(sandbox, fileName, contents = "Date,Description,Amount\n2026-09-01,Coffee,4.25\n") {
  const filePath = join(sandbox.dropboxDir, fileName);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function readLog(sandbox, name) {
  const path = join(sandbox.logDir, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function collectRelativeFiles(root, prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(prefix, entry.name);

    if (entry.isDirectory()) {
      return collectRelativeFiles(root, relativePath);
    }

    return [relativePath];
  });
}

test("real Dropbox ingest refuses to run without a user id before side effects", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "chase-activity.csv");

  const result = runScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(existsSync(csvPath), true);
  assert.equal(readLog(sandbox, "gcloud.log"), "");
  assert.equal(readLog(sandbox, "npm.log"), "");
  assert.equal(readLog(sandbox, "npx.log"), "");
});

test("dry-run remains safe without a user id and leaves dropbox files in place", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Discover"}\n', "utf8");

  const result = runScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
  assert.equal(readLog(sandbox, "gcloud.log"), "");
  assert.equal(readLog(sandbox, "npm.log"), "");
  assert.equal(readLog(sandbox, "npx.log"), "");
});

test(".env.local supplies ingest user and landing bucket defaults", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxFile(sandbox, "chase-activity.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Chase"}\n', "utf8");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)/);

  const gcloudLog = readLog(sandbox, "gcloud.log");
  assert.match(
    gcloudLog,
    /storage cp .*chase-activity\.csv gs:\/\/env-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
  );
  assert.match(
    gcloudLog,
    /storage cp .*chase-activity\.csv\.context\.json gs:\/\/env-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv\.context\.json/,
  );
  assert.equal(
    readLog(sandbox, "npm.log"),
    "run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user\n",
  );
  assert.equal(readLog(sandbox, "npx.log"), "");

  const uploadedFiles = collectRelativeFiles(join(sandbox.dropboxDir, "_uploaded"));
  assert.deepEqual(
    uploadedFiles.map((file) => basename(file)).sort(),
    ["chase-activity.csv", "chase-activity.csv.context.json"],
  );
});

test("--user-id overrides .env.local when forwarding to the ETL runner", () => {
  const sandbox = createSandbox();
  writeDropboxFile(sandbox, "capital_one-checking.csv");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runScript(sandbox, [
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
