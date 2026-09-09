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

const processDropboxScript = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createCommandStub(commandName) {
  return `#!/usr/bin/env bash
node - "$@" <<'NODE'
const fs = require("node:fs");
fs.appendFileSync(
  process.env.COMMAND_LOG,
  JSON.stringify([${JSON.stringify(commandName)}, ...process.argv.slice(2)]) + "\\n",
);
NODE
`;
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const harnessScript = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(processDropboxScript, harnessScript);
  chmodSync(harnessScript, 0o755);

  writeExecutable(
    join(binDirectory, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) printf '2026\\n' ;;
  +%m) printf '04\\n' ;;
  +%d) printf '13\\n' ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  for (const commandName of ["gcloud", "npm", "npx"]) {
    writeExecutable(join(binDirectory, commandName), createCommandStub(commandName));
  }

  const harness = {
    root,
    binDirectory,
    commandLog: join(root, "commands.log"),
    dropboxDirectory,
    script: harnessScript,
  };

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  return harness;
}

function runProcessDropbox(harness, args = [], env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.WAREHOUSE_IMPORT_USER_ID;
  delete childEnv.WAREHOUSE_LANDING_BUCKET;
  delete childEnv.ETL_MAX_FILES;

  Object.assign(childEnv, env, {
    COMMAND_LOG: harness.commandLog,
    PATH: `${harness.binDirectory}:${process.env.PATH}`,
  });

  return spawnSync("bash", [harness.script, ...args], {
    cwd: harness.root,
    env: childEnv,
    encoding: "utf8",
  });
}

function readCommands(harness) {
  if (!existsSync(harness.commandLog)) {
    return [];
  }

  return readFileSync(harness.commandLog, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeDropboxCsv(harness, fileName = "discover-export.csv") {
  const filePath = join(harness.dropboxDirectory, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-13,Coffee,4.50\n", "utf8");
  return filePath;
}

test("Dropbox ingest refuses real uploads without a user id", (t) => {
  const harness = createHarness(t);
  const csvPath = writeDropboxCsv(harness);

  const result = runProcessDropbox(harness);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.deepEqual(readCommands(harness), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(harness.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest dry run does not require a user id or call external tools", (t) => {
  const harness = createHarness(t);
  const csvPath = writeDropboxCsv(harness, "Discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

  const result = runProcessDropbox(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/discover\/2026\/04\/13\/Discover-export\.csv/,
  );
  assert.match(result.stdout, /\(\+ sidecar Discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.deepEqual(readCommands(harness), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("Dropbox ingest uses .env.local defaults and archives uploaded CSVs", (t) => {
  const harness = createHarness(t);
  const csvPath = writeDropboxCsv(harness, "apple_card-april.csv");
  writeFileSync(`${csvPath}.context.json`, '{"userId":"sidecar-user"}\n', "utf8");
  writeFileSync(
    join(harness.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=custom-bucket\n',
    "utf8",
  );

  const result = runProcessDropbox(harness, ["--no-dataform"]);

  assert.equal(result.status, 0);
  assert.deepEqual(readCommands(harness), [
    [
      "gcloud",
      "storage",
      "cp",
      csvPath,
      "gs://custom-bucket/incoming/apple_card/2026/04/13/apple_card-april.csv",
    ],
    [
      "gcloud",
      "storage",
      "cp",
      `${csvPath}.context.json`,
      "gs://custom-bucket/incoming/apple_card/2026/04/13/apple_card-april.csv.context.json",
    ],
    [
      "npm",
      "run",
      "etl:runner",
      "--",
      "--gcs-bucket",
      "custom-bucket",
      "--max-files",
      "50",
      "--user-id",
      "env-user",
    ],
  ]);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);
  assert.equal(
    existsSync(
      join(harness.dropboxDirectory, "_uploaded", "2026-04-13", "apple_card-april.csv"),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(harness.dropboxDirectory, "_uploaded", "2026-04-13", "apple_card-april.csv.context.json"),
    ),
    true,
  );
});

test("Dropbox ingest lets CLI user id override .env.local", (t) => {
  const harness = createHarness(t);
  writeDropboxCsv(harness, "chase-activity.csv");
  writeFileSync(
    join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\n",
    "utf8",
  );

  const result = runProcessDropbox(harness, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0);
  const npmCommand = readCommands(harness).find(([commandName]) => commandName === "npm");

  assert.deepEqual(npmCommand, [
    "npm",
    "run",
    "etl:runner",
    "--",
    "--gcs-bucket",
    "finance-tracker-cdx-etl-landing",
    "--max-files",
    "50",
    "--user-id",
    "cli-user",
  ]);
});
