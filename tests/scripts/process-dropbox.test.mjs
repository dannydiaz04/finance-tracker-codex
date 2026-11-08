import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox(envLocalContents = "") {
  const root = mkdtempSync(join(tmpdir(), "finance-dropbox-script-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  writeExecutable(scriptPath, readFileSync(sourceScriptPath, "utf8"));

  if (envLocalContents) {
    writeFileSync(join(root, ".env.local"), envLocalContents, "utf8");
  }

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
{
  printf 'gcloud'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\\n'
} >> "$TEST_COMMAND_LOG"
`,
  );

  writeExecutable(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash
{
  printf 'npm'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\\n'
} >> "$TEST_COMMAND_LOG"
`,
  );

  writeExecutable(
    join(binDirectory, "npx"),
    `#!/usr/bin/env bash
{
  printf 'npx'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\\n'
} >> "$TEST_COMMAND_LOG"
`,
  );

  return {
    root,
    scriptPath,
    dropboxDirectory,
    binDirectory,
    commandLogPath: join(root, "commands.log"),
  };
}

function writeDropboxCsv(sandbox, fileName = "chase-activity.csv") {
  const csvPath = join(sandbox.dropboxDirectory, fileName);
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");
  return csvPath;
}

function runProcessDropbox(sandbox, args, envOverrides = {}) {
  const env = {
    ...process.env,
    PATH: `${sandbox.binDirectory}${delimiter}${process.env.PATH ?? ""}`,
    TEST_COMMAND_LOG: sandbox.commandLogPath,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  Object.assign(env, envOverrides);

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env,
    encoding: "utf8",
  });
}

function readCommandLog(sandbox) {
  if (!existsSync(sandbox.commandLogPath)) {
    return "";
  }

  return readFileSync(sandbox.commandLogPath, "utf8");
}

test("refuses real ingest without a user id before upload or runner side effects", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox);

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(readCommandLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
});

test("dry run can classify files without a user id or external side effects", () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox, "discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

  const result = runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /discover-export\.csv  ->  discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCommandLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("loads .env.local defaults, uploads sidecars, archives files, and forwards user id", () => {
  const sandbox = createSandbox(`WAREHOUSE_IMPORT_USER_ID="user-from-env"
WAREHOUSE_LANDING_BUCKET='bucket-from-env'
`);
  const csvPath = writeDropboxCsv(sandbox, "apple_card-april.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Apple Card"}\n', "utf8");

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);

  const commandLog = readCommandLog(sandbox);
  assert.match(
    commandLog,
    /gcloud <storage> <cp> <.*apple_card-april\.csv> <gs:\/\/bucket-from-env\/incoming\/apple_card\/2026\/04\/13\/apple_card-april\.csv>/,
  );
  assert.match(
    commandLog,
    /gcloud <storage> <cp> <.*apple_card-april\.csv\.context\.json> <gs:\/\/bucket-from-env\/incoming\/apple_card\/2026\/04\/13\/apple_card-april\.csv\.context\.json>/,
  );
  assert.match(
    commandLog,
    /npm <run> <etl:runner> <--> <--gcs-bucket> <bucket-from-env> <--max-files> <50> <--user-id> <user-from-env>/,
  );
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/apple_card-april.csv")),
    true,
  );
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/apple_card-april.csv.context.json")),
    true,
  );
});

test("command-line user id overrides environment defaults passed to the ETL runner", () => {
  const sandbox = createSandbox("WAREHOUSE_IMPORT_USER_ID=env-local-user\n");
  writeDropboxCsv(sandbox, "capital_one-checking.csv");

  const result = runProcessDropbox(
    sandbox,
    ["--no-dataform", "--user-id", "cli-user"],
    {
      ETL_MAX_FILES: "7",
      WAREHOUSE_IMPORT_USER_ID: "process-env-user",
      WAREHOUSE_LANDING_BUCKET: "process-env-bucket",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readCommandLog(sandbox),
    /npm <run> <etl:runner> <--> <--gcs-bucket> <process-env-bucket> <--max-files> <7> <--user-id> <cli-user>/,
  );
});
