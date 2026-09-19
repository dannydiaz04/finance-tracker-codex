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

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function createScriptRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(repoRoot, "scripts");
  mkdirSync(scriptsDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  mkdirSync(join(repoRoot, "dropbox"), { recursive: true });
  return { repoRoot, scriptPath };
}

function createFakeCommand(binDirectory, commandName, body) {
  const commandPath = join(binDirectory, commandName);
  writeFileSync(commandPath, `#!/usr/bin/env bash\n${body}\n`, "utf8");
  chmodSync(commandPath, 0o755);
}

function createFakeBin(repoRoot) {
  const binDirectory = join(repoRoot, "bin");
  mkdirSync(binDirectory, { recursive: true });

  createFakeCommand(
    binDirectory,
    "gcloud",
    'printf "gcloud %s\\n" "$*" >> "$FAKE_COMMAND_LOG"',
  );
  createFakeCommand(
    binDirectory,
    "npm",
    'printf "npm %s\\n" "$*" >> "$FAKE_COMMAND_LOG"',
  );
  createFakeCommand(
    binDirectory,
    "npx",
    'printf "npx %s\\n" "$*" >> "$FAKE_COMMAND_LOG"',
  );
  createFakeCommand(
    binDirectory,
    "date",
    `case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /usr/bin/date "$@" ;;
esac`,
  );

  return binDirectory;
}

function runProcessDropbox({
  repoRoot,
  scriptPath,
  args = [],
  extraEnv = {},
  fakeBinDirectory,
  commandLogPath,
}) {
  const env = {
    ...process.env,
    WAREHOUSE_IMPORT_USER_ID: "",
    WAREHOUSE_LANDING_BUCKET: "",
    ...extraEnv,
  };

  if (fakeBinDirectory) {
    env.PATH = `${fakeBinDirectory}:${process.env.PATH}`;
  }

  if (commandLogPath) {
    env.FAKE_COMMAND_LOG = commandLogPath;
  }

  return spawnSync("bash", [scriptPath, ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });
}

test("process-dropbox refuses real ingest without a user id before side effects", () => {
  const { repoRoot, scriptPath } = createScriptRepo();
  const fakeBinDirectory = createFakeBin(repoRoot);
  const commandLogPath = join(repoRoot, "commands.log");
  const dropboxFile = join(repoRoot, "dropbox", "discover-export.csv");
  writeFileSync(dropboxFile, "Trans. Date,Post Date,Description,Amount,Category\n", "utf8");

  const result = runProcessDropbox({
    repoRoot,
    scriptPath,
    fakeBinDirectory,
    commandLogPath,
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(commandLogPath), false);
  assert.equal(existsSync(dropboxFile), true);
});

test("process-dropbox dry run is allowed without a user id and does not upload or move files", () => {
  const { repoRoot, scriptPath } = createScriptRepo();
  const fakeBinDirectory = createFakeBin(repoRoot);
  const commandLogPath = join(repoRoot, "commands.log");
  const dropboxFile = join(repoRoot, "dropbox", "capital_one-checking.csv");
  writeFileSync(dropboxFile, "Transaction Date,Description,Debit,Credit\n", "utf8");

  const result = runProcessDropbox({
    repoRoot,
    scriptPath,
    args: ["--dry-run"],
    fakeBinDirectory,
    commandLogPath,
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /capital_one-checking\.csv\s+->\s+capital_one/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(result.stderr, "");
  assert.equal(existsSync(commandLogPath), false);
  assert.equal(existsSync(dropboxFile), true);
});

test("process-dropbox loads env defaults and forwards user id to the ETL runner", () => {
  const { repoRoot, scriptPath } = createScriptRepo();
  const fakeBinDirectory = createFakeBin(repoRoot);
  const commandLogPath = join(repoRoot, "commands.log");
  const dropboxFile = join(repoRoot, "dropbox", "chase-activity.csv");
  writeFileSync(dropboxFile, "Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n", "utf8");
  writeFileSync(
    join(repoRoot, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=env-landing-bucket\n',
    "utf8",
  );

  const result = runProcessDropbox({
    repoRoot,
    scriptPath,
    args: ["--no-dataform"],
    fakeBinDirectory,
    commandLogPath,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bucket: gs:\/\/env-landing-bucket/);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner against the bucket/);
  assert.equal(result.stderr, "");

  const commandLog = readFileSync(commandLogPath, "utf8");
  assert.match(
    commandLog,
    /gcloud storage cp .*chase-activity\.csv gs:\/\/env-landing-bucket\/incoming\/chase\//,
  );
  assert.match(
    commandLog,
    /npm run etl:runner -- --gcs-bucket env-landing-bucket --max-files 50 --user-id env-user-123/,
  );
  assert.doesNotMatch(commandLog, /^npx /m);
  assert.equal(existsSync(dropboxFile), false);
  assert.equal(
    existsSync(join(repoRoot, "dropbox", "_uploaded", "2026-04-13", "chase-activity.csv")),
    true,
  );
});
