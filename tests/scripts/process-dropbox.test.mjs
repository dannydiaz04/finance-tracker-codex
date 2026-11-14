import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function createTempRepo(t) {
  const repoRoot = join(
    tmpdir(),
    `finance-tracker-dropbox-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  const scriptsDirectory = join(repoRoot, "scripts");
  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(join(repoRoot, "dropbox"), { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts/process-dropbox.sh"),
    join(scriptsDirectory, "process-dropbox.sh"),
  );
  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));
  return repoRoot;
}

function installFakeCommands(repoRoot) {
  const fakeBin = join(repoRoot, "fake-bin");
  const logDirectory = join(repoRoot, "command-logs");
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(logDirectory, { recursive: true });

  writeFileSync(
    join(fakeBin, "gcloud"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG_DIR/gcloud.log"
exit 0
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(fakeBin, "npm"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG_DIR/npm.log"
exit 0
`,
    { mode: 0o755 },
  );
  writeFileSync(
    join(fakeBin, "npx"),
    `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_LOG_DIR/npx.log"
exit 0
`,
    { mode: 0o755 },
  );

  return { fakeBin, logDirectory };
}

function runProcessDropbox(repoRoot, args = [], env = {}) {
  const { fakeBin, logDirectory } = installFakeCommands(repoRoot);
  const result = spawnSync(
    "bash",
    [join(repoRoot, "scripts/process-dropbox.sh"), ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        FAKE_LOG_DIR: logDirectory,
        WAREHOUSE_IMPORT_USER_ID: "",
        WAREHOUSE_LANDING_BUCKET: "",
        ...env,
      },
    },
  );

  return { ...result, logDirectory };
}

function readLog(logDirectory, name) {
  const path = join(logDirectory, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function listFilesRecursive(root) {
  if (!existsSync(root)) {
    return [];
  }

  const files = [];
  const visit = (directory, prefix = "") => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        visit(join(directory, entry.name), relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      }
    }
  };

  visit(root);
  return files.sort();
}

function currentArchiveDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

test("process-dropbox refuses live ingest without a user id before side effects", (t) => {
  const repoRoot = createTempRepo(t);
  writeFileSync(
    join(repoRoot, "dropbox/chase-card.csv"),
    "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n",
  );

  const result = runProcessDropbox(repoRoot, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readLog(result.logDirectory, "gcloud.log"), "");
  assert.equal(readLog(result.logDirectory, "npm.log"), "");
  assert.equal(existsSync(join(repoRoot, "dropbox/chase-card.csv")), true);
});

test("process-dropbox dry-run remains safe without a user id", (t) => {
  const repoRoot = createTempRepo(t);
  writeFileSync(
    join(repoRoot, "dropbox/discover-export.csv"),
    "Date,Description,Amount\n2026-04-13,Refund,12.00\n",
  );

  const result = runProcessDropbox(repoRoot, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(result.stdout, /discover-export\.csv  ->  discover/);
  assert.equal(readLog(result.logDirectory, "gcloud.log"), "");
  assert.equal(readLog(result.logDirectory, "npm.log"), "");
  assert.equal(existsSync(join(repoRoot, "dropbox/discover-export.csv")), true);
});

test("process-dropbox reads user id and bucket defaults from .env.local", (t) => {
  const repoRoot = createTempRepo(t);
  writeFileSync(
    join(repoRoot, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=\"env-user-42\"\nWAREHOUSE_LANDING_BUCKET='test-landing-bucket'\n",
  );
  writeFileSync(
    join(repoRoot, "dropbox/chase-card.csv"),
    "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n",
  );
  writeFileSync(
    join(repoRoot, "dropbox/chase-card.csv.context.json"),
    "{\"accountName\":\"Chase\"}\n",
  );

  const result = runProcessDropbox(repoRoot, ["--no-dataform"], {
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readLog(result.logDirectory, "gcloud.log"),
    /gs:\/\/test-landing-bucket\/incoming\/chase\//,
  );
  const npmLog = readLog(result.logDirectory, "npm.log");
  assert.match(
    npmLog,
    /run etl:runner -- --gcs-bucket test-landing-bucket --max-files 7 --user-id env-user-42/,
  );
  assert.equal(readLog(result.logDirectory, "npx.log"), "");
  assert.equal(existsSync(join(repoRoot, "dropbox/chase-card.csv")), false);
  const archiveDate = currentArchiveDate();
  assert.deepEqual(listFilesRecursive(join(repoRoot, "dropbox/_uploaded")), [
    `${archiveDate}/chase-card.csv`,
    `${archiveDate}/chase-card.csv.context.json`,
  ]);
});

test("process-dropbox CLI user id overrides .env.local attribution", (t) => {
  const repoRoot = createTempRepo(t);
  writeFileSync(join(repoRoot, ".env.local"), "WAREHOUSE_IMPORT_USER_ID=env-user\n");
  writeFileSync(
    join(repoRoot, "dropbox/manual.csv"),
    "Date,Description,Amount\n2026-04-13,Adjustment,1.00\n",
  );

  const result = runProcessDropbox(repoRoot, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr);
  const npmLog = readLog(result.logDirectory, "npm.log");
  assert.match(npmLog, /--user-id cli-user/);
  assert.doesNotMatch(npmLog, /env-user/);
});
