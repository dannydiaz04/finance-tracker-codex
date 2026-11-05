import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scriptUnderTest = join(process.cwd(), "scripts/process-dropbox.sh");

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "dropbox"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  copyFileSync(scriptUnderTest, join(root, "scripts/process-dropbox.sh"));
  return root;
}

function writeCsv(root, fileName = "chase-activity.csv") {
  const filePath = join(root, "dropbox", fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n", "utf8");
  return filePath;
}

function writeFakeCommand(root, commandName) {
  const commandPath = join(root, "bin", commandName);
  writeFileSync(
    commandPath,
    [
      "#!/usr/bin/env bash",
      'printf "%s" "$0" >> "$FAKE_COMMAND_LOG"',
      'for arg in "$@"; do printf " %s" "$arg" >> "$FAKE_COMMAND_LOG"; done',
      'printf "\\n" >> "$FAKE_COMMAND_LOG"',
    ].join("\n"),
    "utf8",
  );
  chmodSync(commandPath, 0o755);
}

function runProcessDropbox(root, args = [], env = {}) {
  for (const commandName of ["gcloud", "npm", "npx"]) {
    writeFakeCommand(root, commandName);
  }

  const commandLog = join(root, "commands.log");

  const result = spawnSync("bash", [join(root, "scripts/process-dropbox.sh"), ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...env,
      FAKE_COMMAND_LOG: commandLog,
      PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });

  return {
    ...result,
    commandLog,
    commands: existsSync(commandLog) ? readFileSync(commandLog, "utf8") : "",
  };
}

function uploadedEntries(root) {
  const uploadedRoot = join(root, "dropbox", "_uploaded");
  return existsSync(uploadedRoot) ? readdirSync(uploadedRoot, { recursive: true }) : [];
}

test("refuses real Dropbox ingest without a user id before side effects", () => {
  const root = createSandbox();
  const csvPath = writeCsv(root);

  const result = runProcessDropbox(root, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(result.commands, "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(root, "dropbox", "_uploaded")), false);
});

test("dry run can inspect Dropbox files without credentials or side effects", () => {
  const root = createSandbox();
  const csvPath = writeCsv(root, "discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

  const result = runProcessDropbox(root, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /discover-export\.csv\s+->\s+discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(result.commands, "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("loads user and bucket defaults from .env.local for real ingest", () => {
  const root = createSandbox();
  const csvPath = writeCsv(root);
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Checking"}\n', "utf8");
  writeFileSync(
    join(root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runProcessDropbox(root, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /gcloud storage cp .*chase-activity\.csv gs:\/\/env-bucket\/incoming\/chase\//);
  assert.match(result.commands, /gcloud storage cp .*chase-activity\.csv\.context\.json gs:\/\/env-bucket\/incoming\/chase\/.*chase-activity\.csv\.context\.json/);
  assert.match(result.commands, /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user-123/);

  const archivedFiles = uploadedEntries(root).map((entry) => entry.toString());
  assert.equal(archivedFiles.some((entry) => entry.endsWith("chase-activity.csv")), true);
  assert.equal(
    archivedFiles.some((entry) => entry.endsWith("chase-activity.csv.context.json")),
    true,
  );
  assert.equal(existsSync(csvPath), false);
});

test("CLI user id takes precedence over .env.local when invoking the runner", () => {
  const root = createSandbox();
  writeCsv(root, "capital_one-checking.csv");
  writeFileSync(
    join(root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runProcessDropbox(root, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.commands, /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user/);
  assert.doesNotMatch(result.commands, /--user-id env-user/);
});
