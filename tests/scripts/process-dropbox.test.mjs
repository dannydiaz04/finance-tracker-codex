import assert from "node:assert/strict";
import {
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
const fixedDate = {
  year: "2026",
  month: "04",
  day: "13",
};

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o755 });
}

function createScriptRepo() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const callLog = join(root, "calls.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  copyFileSync(
    join(repoRoot, "scripts/process-dropbox.sh"),
    join(scriptsDir, "process-dropbox.sh"),
  );

  writeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo "${fixedDate.year}" ;;
  +%m) echo "${fixedDate.month}" ;;
  +%d) echo "${fixedDate.day}" ;;
  *) echo "unexpected date argument: $*" >&2; exit 2 ;;
esac
`,
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binDir, command),
      `#!/usr/bin/env bash
printf '%s %s\\n' "${command}" "$*" >> "$TEST_CALL_LOG"
`,
    );
  }

  return {
    root,
    dropboxDir,
    callLog,
    scriptPath: join(scriptsDir, "process-dropbox.sh"),
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      TEST_CALL_LOG: callLog,
    },
  };
}

function runDropboxScript(fixture, args = [], envOverrides = {}) {
  const env = {
    ...fixture.env,
    ...envOverrides,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  Object.assign(env, envOverrides);

  return spawnSync("bash", [fixture.scriptPath, ...args], {
    cwd: fixture.root,
    env,
    encoding: "utf8",
  });
}

function readCallLog(fixture) {
  if (!existsSync(fixture.callLog)) {
    return "";
  }

  return readFileSync(fixture.callLog, "utf8");
}

test("process-dropbox refuses real ingest without a user id before side effects", () => {
  const fixture = createScriptRepo();
  const csvPath = join(fixture.dropboxDir, "discover-export.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-01,Coffee,-4.50\n");

  const result = runDropboxScript(fixture);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readCallLog(fixture), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(
    existsSync(join(fixture.dropboxDir, "_uploaded", "2026-04-13", "discover-export.csv")),
    false,
  );
});

test("process-dropbox dry run stays side-effect free even without a user id", () => {
  const fixture = createScriptRepo();
  const csvPath = join(fixture.dropboxDir, "apple_card-april.csv");
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-04-01,Coffee,-4.50\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Apple Card"}\n');

  const result = runDropboxScript(fixture, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /apple_card-april\.csv  ->  apple_card/);
  assert.match(result.stdout, /\(\+ sidecar apple_card-april\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCallLog(fixture), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("process-dropbox uses .env.local user and bucket for uploads and runner", () => {
  const fixture = createScriptRepo();
  const csvPath = join(fixture.dropboxDir, "CHASE-export.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-01,Coffee,-4.50\n");
  writeFileSync(`${csvPath}.context.json`, '{"sourceAccountId":"chase_checking"}\n');
  writeFileSync(
    join(fixture.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
  );

  const result = runDropboxScript(fixture, ["--no-dataform"]);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner/);

  const uploadedDir = join(fixture.dropboxDir, "_uploaded", "2026-04-13");
  assert.equal(existsSync(join(uploadedDir, "CHASE-export.csv")), true);
  assert.equal(existsSync(join(uploadedDir, "CHASE-export.csv.context.json")), true);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);

  const calls = readCallLog(fixture).trim().split("\n");
  const destination =
    "gs://env-bucket/incoming/chase/2026/04/13/CHASE-export.csv";

  assert.deepEqual(calls, [
    `gcloud storage cp ${csvPath} ${destination}`,
    `gcloud storage cp ${csvPath}.context.json ${destination}.context.json`,
    "npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user",
  ]);
});
