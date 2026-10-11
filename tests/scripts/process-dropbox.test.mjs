import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const fakeBinDir = join(root, "fake-bin");
  const commandLogPath = join(root, "commands.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(fakeBinDir, command),
      `#!/usr/bin/env bash\nprintf '%s\\n' "${command} $*" >> "$FAKE_COMMAND_LOG"\n`,
    );
  }

  const env = {
    ...process.env,
    FAKE_COMMAND_LOG: commandLogPath,
    PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  t.after(() => rmSync(root, { recursive: true, force: true }));

  return {
    root,
    scriptPath,
    dropboxDir,
    commandLogPath,
    env,
  };
}

function runDropboxScript(sandbox, args = []) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env: sandbox.env,
    encoding: "utf8",
  });
}

function writeDropboxCsv(sandbox, fileName = "discover-export.csv") {
  const filePath = join(sandbox.dropboxDir, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-13,Coffee,4.25\n", "utf8");
  return filePath;
}

function readCommandLog(sandbox) {
  return existsSync(sandbox.commandLogPath)
    ? readFileSync(sandbox.commandLogPath, "utf8")
    : "";
}

test("real Dropbox ingest refuses to run without a user id before side effects", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeDropboxCsv(sandbox, "chase-activity.csv");

  const result = runDropboxScript(sandbox);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id\./);
  assert.equal(readCommandLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(sandbox.dropboxDir, "_uploaded")), false);
});

test("dry-run Dropbox ingest remains safe without credentials or user id", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeDropboxCsv(sandbox, "Discover-Export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

  const result = runDropboxScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Discover-Export\.csv\s+->\s+discover/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCommandLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test(".env.local supplies the landing bucket and import user for real ingest", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = writeDropboxCsv(sandbox, "discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const result = runDropboxScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0);
  const commandLog = readCommandLog(sandbox);
  assert.match(
    commandLog,
    /gcloud storage cp .*discover-export\.csv gs:\/\/env-bucket\/incoming\/discover\/\d{4}\/\d{2}\/\d{2}\/discover-export\.csv/,
  );
  assert.match(
    commandLog,
    /gcloud storage cp .*discover-export\.csv\.context\.json gs:\/\/env-bucket\/incoming\/discover\/\d{4}\/\d{2}\/\d{2}\/discover-export\.csv\.context\.json/,
  );
  assert.match(
    commandLog,
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );
  assert.doesNotMatch(commandLog, /^npx /m);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);
  assert.equal(existsSync(join(sandbox.dropboxDir, "_uploaded")), true);
});

test("--user-id takes precedence over .env.local when invoking the ETL runner", (t) => {
  const sandbox = createSandbox(t);
  writeDropboxCsv(sandbox, "capital_one-checking.csv");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runDropboxScript(sandbox, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0);
  assert.match(
    readCommandLog(sandbox),
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user/,
  );
});
