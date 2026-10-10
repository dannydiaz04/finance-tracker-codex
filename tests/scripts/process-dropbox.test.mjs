import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createIsolatedRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(repoRoot, "scripts");
  const dropboxDir = join(repoRoot, "dropbox");
  const binDir = join(repoRoot, "bin");
  const callLogPath = join(repoRoot, "command-calls.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeExecutable(
    join(scriptsDir, "process-dropbox.sh"),
    readFileSync(sourceScriptPath, "utf8"),
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binDir, command),
      `#!/usr/bin/env bash
printf '${command} %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
exit 0
`,
    );
  }

  return {
    repoRoot,
    dropboxDir,
    callLogPath,
    env: {
      ...process.env,
      FAKE_COMMAND_LOG: callLogPath,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
    },
  };
}

function runProcessDropbox(isolatedRepo, args = []) {
  return spawnSync(
    "bash",
    [join(isolatedRepo.repoRoot, "scripts/process-dropbox.sh"), ...args],
    {
      cwd: isolatedRepo.repoRoot,
      env: isolatedRepo.env,
      encoding: "utf8",
    },
  );
}

function readCallLog(isolatedRepo) {
  return existsSync(isolatedRepo.callLogPath)
    ? readFileSync(isolatedRepo.callLogPath, "utf8")
    : "";
}

function writeCsv(dropboxDir, fileName = "chase-activity.csv") {
  const filePath = join(dropboxDir, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-10,Coffee,-5.00\n");
  return filePath;
}

test("Dropbox ingest refuses real runs without a user id before side effects", () => {
  const isolatedRepo = createIsolatedRepo();
  const csvPath = writeCsv(isolatedRepo.dropboxDir);

  const result = runProcessDropbox(isolatedRepo, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readCallLog(isolatedRepo), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(isolatedRepo.dropboxDir, "_uploaded")), false);
});

test("Dropbox dry runs still inspect files without requiring a user id", () => {
  const isolatedRepo = createIsolatedRepo();
  const csvPath = writeCsv(isolatedRepo.dropboxDir, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{ "accountName": "Discover Card" }\n');

  const result = runProcessDropbox(isolatedRepo, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(readCallLog(isolatedRepo), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test("Dropbox ingest loads env defaults and forwards the user id to the runner", () => {
  const isolatedRepo = createIsolatedRepo();
  const csvPath = writeCsv(isolatedRepo.dropboxDir, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{ "accountName": "Capital One Checking" }\n');
  writeFileSync(
    join(isolatedRepo.repoRoot, ".env.local"),
    [
      'WAREHOUSE_IMPORT_USER_ID="user-env"',
      "WAREHOUSE_LANDING_BUCKET='env-bucket'",
      "",
    ].join("\n"),
  );

  const result = runProcessDropbox(isolatedRepo, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const callLog = readCallLog(isolatedRepo);
  assert.match(
    callLog,
    /gcloud storage cp .*capital_one-checking\.csv gs:\/\/env-bucket\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv/,
  );
  assert.match(
    callLog,
    /gcloud storage cp .*capital_one-checking\.csv\.context\.json gs:\/\/env-bucket\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv\.context\.json/,
  );
  assert.match(
    callLog,
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id user-env/,
  );

  const uploadedRoot = join(isolatedRepo.dropboxDir, "_uploaded");
  const [uploadedDate] = readdirSync(uploadedRoot);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(uploadedRoot, uploadedDate, "capital_one-checking.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(uploadedRoot, uploadedDate, "capital_one-checking.csv.context.json"),
    ),
    true,
  );
});
