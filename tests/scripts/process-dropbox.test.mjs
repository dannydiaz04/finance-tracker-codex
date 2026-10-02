import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const scriptSourcePath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createScriptFixture() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const callLogPath = join(root, "calls.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  copyFileSync(scriptSourcePath, join(scriptsDirectory, "process-dropbox.sh"));

  const stub = `#!/usr/bin/env bash
{
  printf '%s' "$(basename "$0")"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$CALL_LOG"
`;

  writeExecutable(join(binDirectory, "gcloud"), stub);
  writeExecutable(join(binDirectory, "npm"), stub);
  writeExecutable(join(binDirectory, "npx"), stub);

  return { root, dropboxDirectory, binDirectory, callLogPath };
}

function runProcessDropbox(fixture, args = [], env = {}) {
  return spawnSync(
    "bash",
    [join(fixture.root, "scripts/process-dropbox.sh"), ...args],
    {
      cwd: fixture.root,
      encoding: "utf8",
      env: {
        ...process.env,
        CALL_LOG: fixture.callLogPath,
        PATH: `${fixture.binDirectory}:${process.env.PATH}`,
        WAREHOUSE_IMPORT_USER_ID: "",
        WAREHOUSE_LANDING_BUCKET: "",
        ...env,
      },
    },
  );
}

function readCallLog(fixture) {
  return existsSync(fixture.callLogPath)
    ? readFileSync(fixture.callLogPath, "utf8")
    : "";
}

test("Dropbox ingest refuses to run without a user id before side effects", () => {
  const fixture = createScriptFixture();
  const csvPath = join(fixture.dropboxDirectory, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-01,Coffee,-5.00\n", "utf8");

  const result = runProcessDropbox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.equal(readCallLog(fixture), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(fixture.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox dry-run remains safe without a configured user id", () => {
  const fixture = createScriptFixture();
  const csvPath = join(fixture.dropboxDirectory, "Apple_Card-April.CSV");
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-04-01,Coffee,-5.00\n", "utf8");
  writeFileSync(`${csvPath}.context.json`, "{}\n", "utf8");

  const result = runProcessDropbox(fixture, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Apple_Card-April\.CSV\s+->\s+apple_card/);
  assert.match(result.stdout, /\(\+ sidecar Apple_Card-April\.CSV\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCallLog(fixture), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test(".env.local user and bucket are used for upload and ETL runner", () => {
  const fixture = createScriptFixture();
  const csvPath = join(fixture.dropboxDirectory, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-01,Coffee,-5.00\n", "utf8");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Chase"}\n', "utf8");
  writeFileSync(
    join(fixture.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'env-bucket\'\n',
    "utf8",
  );

  const result = runProcessDropbox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);

  const calls = readCallLog(fixture);
  assert.match(
    calls,
    /gcloud\tstorage\tcp\t.+chase-activity\.csv\tgs:\/\/env-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
  );
  assert.match(
    calls,
    /gcloud\tstorage\tcp\t.+chase-activity\.csv\.context\.json\tgs:\/\/env-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv\.context\.json/,
  );
  assert.match(
    calls,
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t50\t--user-id\tenv-user/,
  );
  assert.doesNotMatch(calls, /^npx\t/m);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);

  const uploadedDates = readdirSync(join(fixture.dropboxDirectory, "_uploaded"));
  assert.equal(uploadedDates.length, 1);
  assert.equal(
    existsSync(join(fixture.dropboxDirectory, "_uploaded", uploadedDates[0], "chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(
        fixture.dropboxDirectory,
        "_uploaded",
        uploadedDates[0],
        "chase-activity.csv.context.json",
      ),
    ),
    true,
  );
});

test("--user-id overrides the .env.local import user", () => {
  const fixture = createScriptFixture();
  const csvPath = join(fixture.dropboxDirectory, "discover-export.csv");
  writeFileSync(csvPath, "Trans. Date,Post Date,Description,Amount\n04/01/2026,04/01/2026,Coffee,5.00\n", "utf8");
  writeFileSync(
    join(fixture.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    "utf8",
  );

  const result = runProcessDropbox(fixture, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);

  const calls = readCallLog(fixture);
  assert.match(
    calls,
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t50\t--user-id\tcli-user/,
  );
  assert.doesNotMatch(calls, /--user-id\tenv-user/);
});
