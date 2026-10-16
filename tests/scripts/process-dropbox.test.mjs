import assert from "node:assert/strict";
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
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const sourceScriptPath = join(repoRoot, "scripts", "process-dropbox.sh");

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createScriptFixture() {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "finance-dropbox-script-"));
  const scriptsDirectory = join(fixtureRoot, "scripts");
  const dropboxDirectory = join(fixtureRoot, "dropbox");
  const binDirectory = join(fixtureRoot, "bin");
  const commandLogDirectory = join(fixtureRoot, "command-log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  mkdirSync(commandLogDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
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

  writeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash
mkdir -p "$TEST_COMMAND_LOG"
printf '%s\\n' "$*" >> "$TEST_COMMAND_LOG/gcloud.log"
`,
  );

  writeExecutable(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash
mkdir -p "$TEST_COMMAND_LOG"
printf '%s\\n' "$*" >> "$TEST_COMMAND_LOG/npm.log"
`,
  );

  writeExecutable(
    join(binDirectory, "npx"),
    `#!/usr/bin/env bash
mkdir -p "$TEST_COMMAND_LOG"
printf '%s\\n' "$*" >> "$TEST_COMMAND_LOG/npx.log"
`,
  );

  return {
    fixtureRoot,
    scriptPath,
    dropboxDirectory,
    binDirectory,
    commandLogDirectory,
  };
}

function isolatedEnv(fixture, overrides = {}) {
  const env = { ...process.env };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  return {
    ...env,
    ...overrides,
    PATH: `${fixture.binDirectory}:${env.PATH ?? ""}`,
    TEST_COMMAND_LOG: fixture.commandLogDirectory,
  };
}

function runProcessDropbox(fixture, args = [], envOverrides = {}) {
  return spawnSync("bash", [fixture.scriptPath, ...args], {
    cwd: fixture.fixtureRoot,
    env: isolatedEnv(fixture, envOverrides),
    encoding: "utf8",
  });
}

function writeDropboxCsv(fixture, fileName = "discover-export.csv") {
  const filePath = join(fixture.dropboxDirectory, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");
  return filePath;
}

function readCommandLog(fixture, command) {
  const logPath = join(fixture.commandLogDirectory, `${command}.log`);

  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

test("Dropbox ingest refuses real uploads without a user id before side effects", () => {
  const fixture = createScriptFixture();
  const csvPath = writeDropboxCsv(fixture);

  const result = runProcessDropbox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(readCommandLog(fixture, "gcloud"), "");
  assert.equal(readCommandLog(fixture, "npm"), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(fixture.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox dry run remains safe without credentials or a user id", () => {
  const fixture = createScriptFixture();
  const csvPath = writeDropboxCsv(fixture, "chase-activity.csv");

  const result = runProcessDropbox(fixture, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /chase-activity\.csv\s+->\s+chase/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCommandLog(fixture, "gcloud"), "");
  assert.equal(readCommandLog(fixture, "npm"), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(fixture.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest loads .env.local user and bucket before uploading and running ETL", () => {
  const fixture = createScriptFixture();
  const csvPath = writeDropboxCsv(fixture, "capital_one-checking.csv");
  const contextPath = `${csvPath}.context.json`;

  writeFileSync(contextPath, '{"sourceAccountId":"capital-one-checking"}\n');
  writeFileSync(
    join(fixture.fixtureRoot, ".env.local"),
    [
      "WAREHOUSE_IMPORT_USER_ID=env-user-123",
      'WAREHOUSE_LANDING_BUCKET="env-bucket"',
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runProcessDropbox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner/);

  const gcloudLog = readCommandLog(fixture, "gcloud");
  assert.match(
    gcloudLog,
    /storage cp .*capital_one-checking\.csv gs:\/\/env-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv/,
  );
  assert.match(
    gcloudLog,
    /storage cp .*capital_one-checking\.csv\.context\.json gs:\/\/env-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv\.context\.json/,
  );
  assert.match(
    readCommandLog(fixture, "npm"),
    /run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user-123/,
  );
  assert.equal(readCommandLog(fixture, "npx"), "");
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(contextPath), false);
  assert.equal(
    existsSync(
      join(
        fixture.dropboxDirectory,
        "_uploaded",
        "2026-04-13",
        "capital_one-checking.csv",
      ),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(
        fixture.dropboxDirectory,
        "_uploaded",
        "2026-04-13",
        "capital_one-checking.csv.context.json",
      ),
    ),
    true,
  );
});

test("Dropbox CLI user id takes precedence over .env.local", () => {
  const fixture = createScriptFixture();
  writeDropboxCsv(fixture, "discover-export.csv");
  writeFileSync(
    join(fixture.fixtureRoot, ".env.local"),
    [
      "WAREHOUSE_IMPORT_USER_ID=env-user-123",
      "WAREHOUSE_LANDING_BUCKET=env-bucket",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runProcessDropbox(fixture, [
    "--no-dataform",
    "--user-id",
    "cli-user-456",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readCommandLog(fixture, "npm"),
    /run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user-456/,
  );
  assert.doesNotMatch(readCommandLog(fixture, "npm"), /env-user-123/);
});
