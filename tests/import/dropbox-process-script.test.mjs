import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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

function installFakeCommand(binDir, commandName) {
  writeFileSync(
    join(binDir, commandName),
    `#!/usr/bin/env bash
{
  printf '${commandName}'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
`,
    { mode: 0o755 },
  );
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const commandLog = join(root, "commands.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  copyFileSync(
    join(process.cwd(), "scripts/process-dropbox.sh"),
    join(scriptsDir, "process-dropbox.sh"),
  );
  installFakeCommand(binDir, "gcloud");
  installFakeCommand(binDir, "npm");

  t.after(() => rmSync(root, { recursive: true, force: true }));

  return {
    root,
    dropboxDir,
    binDir,
    commandLog,
    scriptPath: join(scriptsDir, "process-dropbox.sh"),
  };
}

function runDropboxScript(harness, args = [], envOverrides = {}) {
  const env = { ...process.env };
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;

  Object.assign(env, envOverrides, {
    COMMAND_LOG: harness.commandLog,
    PATH: `${harness.binDir}:${process.env.PATH ?? ""}`,
  });

  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    env,
    encoding: "utf8",
  });
}

function writeCsv(dropboxDir, fileName = "chase-activity.csv") {
  const filePath = join(dropboxDir, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");
  return filePath;
}

test("Dropbox ingest refuses real uploads without a user id before side effects", (t) => {
  const harness = createHarness(t);
  const csvPath = writeCsv(harness.dropboxDir);

  const result = runDropboxScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.equal(existsSync(harness.commandLog), false);
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox dry runs do not require a user id or run upload commands", (t) => {
  const harness = createHarness(t);
  const csvPath = writeCsv(harness.dropboxDir, "capital_one-checking.csv");
  writeFileSync(
    join(harness.root, ".env.local"),
    'WAREHOUSE_LANDING_BUCKET="dry-run-bucket"\n',
  );

  const result = runDropboxScript(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Bucket: gs:\/\/dry-run-bucket/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(existsSync(harness.commandLog), false);
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox real ingest passes the resolved user id to the ETL runner", (t) => {
  const harness = createHarness(t);
  const csvPath = writeCsv(harness.dropboxDir);
  writeFileSync(
    join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=landing-bucket\n",
  );

  const result = runDropboxScript(harness, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0);
  assert.equal(existsSync(csvPath), false);

  const commandLog = readFileSync(harness.commandLog, "utf8");
  assert.match(
    commandLog,
    /gcloud <storage> <cp> <.*chase-activity\.csv> <gs:\/\/landing-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv>/,
  );
  assert.match(
    commandLog,
    /npm <run> <etl:runner> <--> <--gcs-bucket> <landing-bucket> <--max-files> <50> <--user-id> <cli-user>/,
  );
});
