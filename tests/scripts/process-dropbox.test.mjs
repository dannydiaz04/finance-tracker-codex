import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");
const sourceScript = readFileSync(sourceScriptPath, "utf8");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createHarness({ envLocal = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "finance-dropbox-script-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const logDirectory = join(root, "logs");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  mkdirSync(logDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  writeFileSync(scriptPath, sourceScript, "utf8");

  if (envLocal) {
    writeFileSync(join(root, ".env.local"), envLocal, "utf8");
  }

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

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binDirectory, command),
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_LOG_DIR/${command}.log"
`,
    );
  }

  return { root, scriptPath, dropboxDirectory, binDirectory, logDirectory };
}

function writeDropboxFile(harness, fileName, contents = "Date,Description,Amount\n") {
  const filePath = join(harness.dropboxDirectory, fileName);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function readLog(harness, command) {
  const logPath = join(harness.logDirectory, `${command}.log`);
  return existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
}

function runScript(harness, args = [], env = {}) {
  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${harness.binDirectory}:${process.env.PATH}`,
      FAKE_LOG_DIR: harness.logDirectory,
      ETL_MAX_FILES: "",
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
  });
}

test("Dropbox ingest refuses a real run without a user id before side effects", () => {
  const harness = createHarness();
  const csvPath = writeDropboxFile(harness, "chase-activity.csv");

  const result = runScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readLog(harness, "gcloud"), "");
  assert.equal(readLog(harness, "npm"), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry-run remains safe without credentials or a user id", () => {
  const harness = createHarness();
  const csvPath = writeDropboxFile(harness, "apple_card-april.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"accountName":"Apple Card"}\n', "utf8");

  const result = runScript(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/apple_card\/2026\/04\/13\/apple_card-april\.csv/,
  );
  assert.equal(readLog(harness, "gcloud"), "");
  assert.equal(readLog(harness, "npm"), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test(".env.local supplies the required user id and landing bucket", () => {
  const harness = createHarness({
    envLocal:
      'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=\'custom-landing-bucket\'\n',
  });
  const csvPath = writeDropboxFile(harness, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"sourceAccountId":"discover-card"}\n', "utf8");

  const result = runScript(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)/);
  assert.match(
    readLog(harness, "gcloud"),
    /storage cp .*discover-export\.csv gs:\/\/custom-landing-bucket\/incoming\/discover\/2026\/04\/13\/discover-export\.csv/,
  );
  assert.match(
    readLog(harness, "gcloud"),
    /storage cp .*discover-export\.csv\.context\.json gs:\/\/custom-landing-bucket\/incoming\/discover\/2026\/04\/13\/discover-export\.csv\.context\.json/,
  );
  assert.match(
    readLog(harness, "npm"),
    /run etl:runner -- --gcs-bucket custom-landing-bucket --max-files 50 --user-id env-user-123/,
  );
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(harness.dropboxDirectory, "_uploaded/2026-04-13/discover-export.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(harness.dropboxDirectory, "_uploaded/2026-04-13/discover-export.csv.context.json"),
    ),
    true,
  );
});

test("CLI user id overrides .env.local when invoking the ETL runner", () => {
  const harness = createHarness({
    envLocal:
      "WAREHOUSE_IMPORT_USER_ID=env-user-123\nWAREHOUSE_LANDING_BUCKET=custom-landing-bucket\n",
  });
  writeDropboxFile(harness, "capital_one-checking.csv");

  const result = runScript(harness, [
    "--no-dataform",
    "--user-id",
    "cli-user-456",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readLog(harness, "npm"),
    /run etl:runner -- --gcs-bucket custom-landing-bucket --max-files 50 --user-id cli-user-456/,
  );
});
