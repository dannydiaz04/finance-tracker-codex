import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts", "process-dropbox.sh");

function createIsolatedRepo() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  copyFileSync(sourceScriptPath, join(scriptsDir, "process-dropbox.sh"));
  chmodSync(join(scriptsDir, "process-dropbox.sh"), 0o755);

  writeFakeCommand(binDir, "gcloud");
  writeFakeCommand(binDir, "npm");
  writeFakeCommand(binDir, "npx");
  writeFileSync(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /bin/date "$@" ;;
esac
`,
    "utf8",
  );
  chmodSync(join(binDir, "date"), 0o755);

  return {
    binDir,
    dropboxDir,
    logPath: join(root, "commands.log"),
    root,
    scriptPath: join(scriptsDir, "process-dropbox.sh"),
  };
}

function writeFakeCommand(binDir, name) {
  const commandPath = join(binDir, name);
  writeFileSync(
    commandPath,
    `#!/usr/bin/env bash
{
  printf '%s' "$(basename "$0")"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$FAKE_COMMAND_LOG"
`,
    "utf8",
  );
  chmodSync(commandPath, 0o755);
}

function writeDropboxCsv(dropboxDir, fileName = "chase-activity.csv") {
  const filePath = join(dropboxDir, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-12,Coffee,4.25\n", "utf8");
  return filePath;
}

function runDropboxScript(repo, args = [], extraEnv = {}) {
  return spawnSync("bash", [repo.scriptPath, ...args], {
    cwd: repo.root,
    encoding: "utf8",
    env: {
      FAKE_COMMAND_LOG: repo.logPath,
      PATH: `${repo.binDir}:${process.env.PATH}`,
      ...extraEnv,
    },
  });
}

function readCommandLog(repo) {
  return existsSync(repo.logPath) ? readFileSync(repo.logPath, "utf8") : "";
}

test("process-dropbox refuses real ingest without a user id before side effects", () => {
  const repo = createIsolatedRepo();
  const csvPath = writeDropboxCsv(repo.dropboxDir);

  const result = runDropboxScript(repo, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readCommandLog(repo), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(repo.dropboxDir, "_uploaded")), false);
});

test("process-dropbox dry run is safe without credentials or user id", () => {
  const repo = createIsolatedRepo();
  const csvPath = writeDropboxCsv(repo.dropboxDir, "capital_one-checking.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Checking"}\n', "utf8");

  const result = runDropboxScript(repo, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /capital_one-checking\.csv  ->  capital_one/);
  assert.match(result.stdout, /\(\+ sidecar capital_one-checking\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCommandLog(repo), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("process-dropbox loads .env.local defaults, uploads sidecars, archives files, and forwards user id", () => {
  const repo = createIsolatedRepo();
  const csvPath = writeDropboxCsv(repo.dropboxDir, "Discover-Export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");
  writeFileSync(
    join(repo.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runDropboxScript(repo, ["--no-dataform"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Bucket: gs:\/\/env-bucket/);
  assert.match(result.stdout, /uploaded sidecar context\.json/);

  const log = readCommandLog(repo);
  assert.match(
    log,
    /gcloud\tstorage\tcp\t.*Discover-Export\.csv\tgs:\/\/env-bucket\/incoming\/discover\/2026\/04\/13\/Discover-Export\.csv/,
  );
  assert.match(
    log,
    /gcloud\tstorage\tcp\t.*Discover-Export\.csv\.context\.json\tgs:\/\/env-bucket\/incoming\/discover\/2026\/04\/13\/Discover-Export\.csv\.context\.json/,
  );
  assert.match(
    log,
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t50\t--user-id\tenv-user/,
  );
  assert.doesNotMatch(log, /^npx\t/m);

  const archivedCsvPath = join(repo.dropboxDir, "_uploaded", "2026-04-13", "Discover-Export.csv");
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);
  assert.equal(existsSync(archivedCsvPath), true);
  assert.equal(existsSync(`${archivedCsvPath}.context.json`), true);
});

test("process-dropbox lets explicit --user-id override .env.local", () => {
  const repo = createIsolatedRepo();
  writeDropboxCsv(repo.dropboxDir, "manual.csv");
  writeFileSync(
    join(repo.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runDropboxScript(repo, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0);
  assert.match(
    readCommandLog(repo),
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t50\t--user-id\tcli-user/,
  );
});
