import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const sourceScript = join(repoRoot, "scripts", "process-dropbox.sh");

function writeFakeCommand(fakeBin, name) {
  writeFileSync(
    join(fakeBin, name),
    `#!/usr/bin/env bash
{
  printf '${name}'
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$ACTION_LOG"
`,
    { mode: 0o755 },
  );
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const fakeBin = join(root, "fake-bin");
  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  const commandLogPath = join(root, "commands.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });
  copyFileSync(sourceScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeFakeCommand(fakeBin, "gcloud");
  writeFakeCommand(fakeBin, "npm");
  writeFakeCommand(fakeBin, "npx");

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  return {
    root,
    scriptPath,
    dropboxDirectory,
    commandLogPath,
    env: {
      ...process.env,
      ACTION_LOG: commandLogPath,
      ETL_MAX_FILES: "",
      PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
    },
  };
}

function runHarness(harness, args = []) {
  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    encoding: "utf8",
    env: harness.env,
  });
}

function readCommandLog(harness) {
  return existsSync(harness.commandLogPath)
    ? readFileSync(harness.commandLogPath, "utf8")
    : "";
}

function listRelativeFiles(root) {
  if (!existsSync(root)) {
    return [];
  }

  const files = [];

  function walk(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath, relativePath);
      } else {
        files.push(relativePath);
      }
    }
  }

  walk(root);
  return files.sort();
}

test("Dropbox ingest refuses real runs without a user id before side effects", (t) => {
  const harness = createHarness(t);
  const csvPath = join(harness.dropboxDirectory, "discover-export.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-01,Coffee,-4.25\n");

  const result = runHarness(harness, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(readCommandLog(harness), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(harness.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest dry-run is safe without a user id", (t) => {
  const harness = createHarness(t);
  const csvPath = join(harness.dropboxDirectory, "Capital_One-Checking.CSV");
  writeFileSync(csvPath, "Transaction Date,Description,Debit,Credit\n");
  writeFileSync(
    `${csvPath}.context.json`,
    JSON.stringify({ sourceAccountId: "capital_one_360_checking_5980" }),
  );

  const result = runHarness(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Capital_One-Checking\.CSV\s+->\s+capital_one/);
  assert.match(result.stdout, /\(\+ sidecar Capital_One-Checking\.CSV\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCommandLog(harness), "");
  assert.equal(existsSync(csvPath), true);
});

test(".env.local user and bucket are used for upload, runner, and archive", (t) => {
  const harness = createHarness(t);
  writeFileSync(
    join(harness.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=\'custom-bucket\'\n',
  );
  const csvPath = join(harness.dropboxDirectory, "apple_card-April.csv");
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n");
  writeFileSync(
    `${csvPath}.context.json`,
    JSON.stringify({ sourceAccountId: "apple_card" }),
  );

  const result = runHarness(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  const commandLog = readCommandLog(harness);
  assert.match(commandLog, /gcloud\tstorage\tcp\t/);
  assert.match(
    commandLog,
    /gs:\/\/custom-bucket\/incoming\/apple_card\/\d{4}\/\d{2}\/\d{2}\/apple_card-April\.csv/,
  );
  assert.match(
    commandLog,
    /gs:\/\/custom-bucket\/incoming\/apple_card\/\d{4}\/\d{2}\/\d{2}\/apple_card-April\.csv\.context\.json/,
  );
  assert.match(
    commandLog,
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tcustom-bucket\t--max-files\t50\t--user-id\tenv-user-123/,
  );
  assert.doesNotMatch(commandLog, /^npx\t/m);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);

  const archivedFiles = listRelativeFiles(join(harness.dropboxDirectory, "_uploaded"));
  assert.ok(
    archivedFiles.some((file) => file.endsWith("/apple_card-April.csv")),
    "expected CSV to be archived under dropbox/_uploaded",
  );
  assert.ok(
    archivedFiles.some((file) => file.endsWith("/apple_card-April.csv.context.json")),
    "expected sidecar context to be archived under dropbox/_uploaded",
  );
});

test("CLI user id overrides .env.local when forwarding to the runner", (t) => {
  const harness = createHarness(t);
  writeFileSync(
    join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user-123\nWAREHOUSE_LANDING_BUCKET=custom-bucket\n",
  );
  writeFileSync(
    join(harness.dropboxDirectory, "manual-transactions.csv"),
    "Date,Description,Amount\n2026-04-01,Coffee,-4.25\n",
  );

  const result = runHarness(harness, [
    "--user-id",
    "cli-user-456",
    "--no-dataform",
  ]);

  assert.equal(result.status, 0, result.stderr);
  const commandLog = readCommandLog(harness);
  assert.match(commandLog, /--user-id\tcli-user-456/);
  assert.doesNotMatch(commandLog, /env-user-123/);
});
