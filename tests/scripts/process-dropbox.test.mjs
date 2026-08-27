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
import { dirname, join } from "node:path";
import test from "node:test";

const scriptSourcePath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const scriptPath = join(root, "scripts/process-dropbox.sh");
  const dropboxPath = join(root, "dropbox");
  const fakeBinPath = join(root, "fake-bin");
  const commandLogPath = join(root, "commands.log");

  mkdirSync(dirname(scriptPath), { recursive: true });
  mkdirSync(dropboxPath, { recursive: true });
  mkdirSync(fakeBinPath, { recursive: true });
  copyFileSync(scriptSourcePath, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeExecutable(
    join(fakeBinPath, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  const env = {
    ...process.env,
    PATH: `${fakeBinPath}:${process.env.PATH}`,
    FAKE_COMMAND_LOG: commandLogPath,
  };
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;

  return { root, scriptPath, dropboxPath, fakeBinPath, commandLogPath, env };
}

function installCommandFakes(fakeBinPath) {
  const logger = `printf '%s' "$0" >> "$FAKE_COMMAND_LOG"
for arg in "$@"; do
  printf '|%s' "$arg" >> "$FAKE_COMMAND_LOG"
done
printf '\\n' >> "$FAKE_COMMAND_LOG"
`;

  writeExecutable(
    join(fakeBinPath, "gcloud"),
    `#!/usr/bin/env bash
${logger}`,
  );
  writeExecutable(
    join(fakeBinPath, "npm"),
    `#!/usr/bin/env bash
${logger}`,
  );
  writeExecutable(
    join(fakeBinPath, "npx"),
    `#!/usr/bin/env bash
${logger}`,
  );
}

function writeDropboxCsv(dropboxPath, fileName = "chase-activity.csv") {
  const filePath = join(dropboxPath, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n", "utf8");
  return filePath;
}

function runScript(scriptPath, args, env) {
  return spawnSync("bash", [scriptPath, ...args], {
    env,
    encoding: "utf8",
  });
}

test("Dropbox ingest refuses real processing when no import user id is configured", (t) => {
  const { scriptPath, dropboxPath, commandLogPath, env } = createHarness(t);
  const csvPath = writeDropboxCsv(dropboxPath);

  const result = runScript(scriptPath, ["--no-dataform"], env);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(commandLogPath), false);
});

test("Dropbox ingest dry run remains safe without an import user id", (t) => {
  const { scriptPath, dropboxPath, commandLogPath, env } = createHarness(t);
  const csvPath = writeDropboxCsv(dropboxPath, "discover-export.csv");

  const result = runScript(scriptPath, ["--dry-run"], env);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Found 1 file\(s\) in dropbox/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(commandLogPath), false);
});

test("Dropbox ingest loads env-local user and bucket then forwards the user id to ETL", (t) => {
  const { root, scriptPath, dropboxPath, fakeBinPath, commandLogPath, env } = createHarness(t);
  installCommandFakes(fakeBinPath);
  writeFileSync(
    join(root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID='env-user-123'\nWAREHOUSE_LANDING_BUCKET=\"env-bucket\"\n",
    "utf8",
  );
  const csvPath = writeDropboxCsv(dropboxPath, "discover-export.csv");

  const result = runScript(scriptPath, ["--no-dataform"], env);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(existsSync(csvPath), false);
  assert.equal(
    existsSync(join(dropboxPath, "_uploaded/2026-04-13/discover-export.csv")),
    true,
  );

  const commandLog = readFileSync(commandLogPath, "utf8");
  assert.match(
    commandLog,
    /gcloud\|storage\|cp\|.*discover-export\.csv\|gs:\/\/env-bucket\/incoming\/discover\/2026\/04\/13\/discover-export\.csv/,
  );
  assert.match(
    commandLog,
    /npm\|run\|etl:runner\|--\|--gcs-bucket\|env-bucket\|--max-files\|50\|--user-id\|env-user-123/,
  );
});
