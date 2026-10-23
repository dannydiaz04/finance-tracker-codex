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
import { join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createIsolatedRepo(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const callLogPath = join(root, "calls.log");

  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

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

  const logCommand = `{
  printf '%s' "$(basename "$0")"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$CALL_LOG"
`;

  writeExecutable(join(binDirectory, "gcloud"), `#!/usr/bin/env bash\n${logCommand}`);
  writeExecutable(join(binDirectory, "npm"), `#!/usr/bin/env bash\n${logCommand}`);
  writeExecutable(join(binDirectory, "npx"), `#!/usr/bin/env bash\n${logCommand}`);

  const env = { ...process.env };
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;

  return {
    root,
    scriptPath,
    dropboxDirectory,
    callLogPath,
    env: {
      ...env,
      CALL_LOG: callLogPath,
      PATH: `${binDirectory}:${process.env.PATH}`,
      TZ: "UTC",
    },
  };
}

function runProcessDropbox(repo, args = [], env = {}) {
  return spawnSync("bash", [repo.scriptPath, ...args], {
    cwd: repo.root,
    env: { ...repo.env, ...env },
    encoding: "utf8",
  });
}

function readCalls(repo) {
  if (!existsSync(repo.callLogPath)) {
    return [];
  }

  return readFileSync(repo.callLogPath, "utf8").trim().split("\n").filter(Boolean);
}

test("process-dropbox refuses real ingest without a user id before side effects", (t) => {
  const repo = createIsolatedRepo(t);
  const csvPath = join(repo.dropboxDirectory, "discover-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");

  const result = runProcessDropbox(repo, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.deepEqual(readCalls(repo), []);
  assert.equal(existsSync(csvPath), true);
});

test("process-dropbox dry run remains safe without credentials", (t) => {
  const repo = createIsolatedRepo(t);
  const csvPath = join(repo.dropboxDirectory, "chase-activity.csv");
  writeFileSync(csvPath, "Details,Posting Date,Amount\nCoffee,04/13/2026,-4.50\n", "utf8");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Chase"}\n', "utf8");

  const result = runProcessDropbox(repo, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /\(\+ sidecar chase-activity\.csv\.context\.json\)/);
  assert.deepEqual(readCalls(repo), []);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("process-dropbox uses .env.local defaults for upload, archive, and runner scoping", (t) => {
  const repo = createIsolatedRepo(t);
  writeFileSync(
    join(repo.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const csvPath = join(repo.dropboxDirectory, "american_express-activity.csv");
  const contextPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");
  writeFileSync(contextPath, '{"accountName":"Amex"}\n', "utf8");

  const result = runProcessDropbox(repo, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readCalls(repo), [
    [
      "gcloud",
      "storage",
      "cp",
      csvPath,
      "gs://env-bucket/incoming/american_express/2026/04/13/american_express-activity.csv",
    ].join("\t"),
    [
      "gcloud",
      "storage",
      "cp",
      contextPath,
      "gs://env-bucket/incoming/american_express/2026/04/13/american_express-activity.csv.context.json",
    ].join("\t"),
    [
      "npm",
      "run",
      "etl:runner",
      "--",
      "--gcs-bucket",
      "env-bucket",
      "--max-files",
      "50",
      "--user-id",
      "env-user",
    ].join("\t"),
  ]);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(contextPath), false);
  assert.equal(
    existsSync(join(repo.dropboxDirectory, "_uploaded/2026-04-13/american_express-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(repo.dropboxDirectory, "_uploaded/2026-04-13/american_express-activity.csv.context.json"),
    ),
    true,
  );
});

test("process-dropbox command line user id overrides .env.local", (t) => {
  const repo = createIsolatedRepo(t);
  writeFileSync(
    join(repo.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );
  writeFileSync(
    join(repo.dropboxDirectory, "manual-upload.csv"),
    "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n",
    "utf8",
  );

  const result = runProcessDropbox(repo, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readCalls(repo).at(-1),
    [
      "npm",
      "run",
      "etl:runner",
      "--",
      "--gcs-bucket",
      "env-bucket",
      "--max-files",
      "50",
      "--user-id",
      "cli-user",
    ].join("\t"),
  );
});
