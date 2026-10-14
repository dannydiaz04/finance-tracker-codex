import assert from "node:assert/strict";
import { execFile } from "node:child_process";
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

const repoRoot = process.cwd();
const sourceScript = join(repoRoot, "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const commandLog = join(root, "commands.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  const recorder = `#!/usr/bin/env bash
{
  printf '%s' "$(basename "$0")"
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
`;

  writeExecutable(join(binDirectory, "gcloud"), recorder);
  writeExecutable(join(binDirectory, "npm"), recorder);
  writeExecutable(join(binDirectory, "npx"), recorder);
  writeExecutable(
    join(binDirectory, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  return {
    root,
    scriptPath,
    dropboxDirectory,
    binDirectory,
    commandLog,
  };
}

function readCommandLog(sandbox) {
  if (!existsSync(sandbox.commandLog)) {
    return "";
  }

  return readFileSync(sandbox.commandLog, "utf8");
}

function runProcessor(sandbox, args = [], envOverrides = {}) {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [sandbox.scriptPath, ...args],
      {
        cwd: sandbox.root,
        env: {
          ...process.env,
          ETL_MAX_FILES: "",
          FAKE_COMMAND_LOG: sandbox.commandLog,
          PATH: `${sandbox.binDirectory}:${process.env.PATH}`,
          WAREHOUSE_IMPORT_USER_ID: "",
          WAREHOUSE_LANDING_BUCKET: "",
          ...envOverrides,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          code: error?.code ?? 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

test("dropbox processor refuses real ingest without a user id before side effects", async (t) => {
  const sandbox = createSandbox(t);
  const csvPath = join(sandbox.dropboxDirectory, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");

  const result = await runProcessor(sandbox, ["--no-dataform"]);

  assert.equal(result.code, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readCommandLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
});

test("dropbox processor dry-run still classifies files without credentials", async (t) => {
  const sandbox = createSandbox(t);
  const csvPath = join(sandbox.dropboxDirectory, "American_Express-April.CSV");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Groceries,-32.10\n", "utf8");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Amex"}\n', "utf8");

  const result = await runProcessor(sandbox, ["--dry-run"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /American_Express-April\.CSV\s+->\s+american_express/);
  assert.match(result.stdout, /\(\+ sidecar American_Express-April\.CSV\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(readCommandLog(sandbox), "");
  assert.equal(existsSync(csvPath), true);
});

test("dropbox processor loads env defaults, uploads sidecars, archives files, and forwards the user id", async (t) => {
  const sandbox = createSandbox(t);
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const csvPath = join(sandbox.dropboxDirectory, "apple_card-activity.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Hardware,-25.00\n", "utf8");
  writeFileSync(sidecarPath, '{"accountName":"Apple Card"}\n', "utf8");

  const result = await runProcessor(sandbox, ["--no-dataform"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /Bucket: gs:\/\/env-bucket/);
  assert.match(result.stdout, /uploaded sidecar context\.json/);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/apple_card-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/apple_card-activity.csv.context.json")),
    true,
  );

  const commandLog = readCommandLog(sandbox);
  assert.match(
    commandLog,
    /gcloud <storage> <cp> <.*apple_card-activity\.csv> <gs:\/\/env-bucket\/incoming\/apple_card\/2026\/04\/13\/apple_card-activity\.csv>/,
  );
  assert.match(
    commandLog,
    /gcloud <storage> <cp> <.*apple_card-activity\.csv\.context\.json> <gs:\/\/env-bucket\/incoming\/apple_card\/2026\/04\/13\/apple_card-activity\.csv\.context\.json>/,
  );
  assert.match(
    commandLog,
    /npm <run> <etl:runner> <--> <--gcs-bucket> <env-bucket> <--max-files> <50> <--user-id> <env-user-123>/,
  );
  assert.doesNotMatch(commandLog, /npx <dataform>/);
});

test("dropbox processor lets --user-id override the env default for the ETL runner", async (t) => {
  const sandbox = createSandbox(t);
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user-123\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );
  writeFileSync(
    join(sandbox.dropboxDirectory, "discover-export.csv"),
    "Date,Description,Amount\n2026-04-13,Payment,-5.00\n",
    "utf8",
  );

  const result = await runProcessor(sandbox, ["--no-dataform", "--user-id", "cli-user-456"]);

  assert.equal(result.code, 0);

  const commandLog = readCommandLog(sandbox);
  assert.match(
    commandLog,
    /npm <run> <etl:runner> <--> <--gcs-bucket> <env-bucket> <--max-files> <50> <--user-id> <cli-user-456>/,
  );
  assert.doesNotMatch(commandLog, /<--user-id> <env-user-123>/);
});
