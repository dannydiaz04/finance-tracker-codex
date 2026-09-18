import assert from "node:assert/strict";
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
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function createScriptHarness() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const logPath = join(root, "command-log.txt");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeShim(
    binDir,
    "date",
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 09 ;;
  +%d) echo 18 ;;
  *) /bin/date "$@" ;;
esac
`,
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    writeShim(
      binDir,
      command,
      `#!/usr/bin/env bash
printf '${command}' >> "$COMMAND_LOG"
for arg in "$@"; do
  printf ' [%s]' "$arg" >> "$COMMAND_LOG"
done
printf '\\n' >> "$COMMAND_LOG"
`,
    );
  }

  return { root, dropboxDir, logPath, scriptPath, binDir };
}

function writeShim(binDir, name, contents) {
  const shimPath = join(binDir, name);
  writeFileSync(shimPath, contents, "utf8");
  chmodSync(shimPath, 0o755);
}

function runDropboxScript(harness, args = [], env = {}) {
  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    env: {
      ...process.env,
      ...env,
      COMMAND_LOG: harness.logPath,
      PATH: `${harness.binDir}${delimiter}${process.env.PATH}`,
    },
    encoding: "utf8",
  });
}

function writeDropboxFile(harness, fileName, contents = "Date,Description,Amount\n2026-09-18,Coffee,4.50\n") {
  const filePath = join(harness.dropboxDir, fileName);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function readCommandLog(harness) {
  return existsSync(harness.logPath) ? readFileSync(harness.logPath, "utf8") : "";
}

test("Dropbox ingest refuses a real run without a user id before side effects", () => {
  const harness = createScriptHarness();
  const filePath = writeDropboxFile(harness, "discover-export.csv");

  const result = runDropboxScript(harness, ["--no-dataform"], {
    WAREHOUSE_IMPORT_USER_ID: "",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(readCommandLog(harness), "");
  assert.equal(existsSync(filePath), true);
});

test("Dropbox dry run remains safe without a user id", () => {
  const harness = createScriptHarness();
  const filePath = writeDropboxFile(harness, "apple_card-september.csv");
  writeFileSync(`${filePath}.context.json`, '{"sourceAccountId":"apple"}\n', "utf8");

  const result = runDropboxScript(harness, ["--dry-run"], {
    WAREHOUSE_IMPORT_USER_ID: "",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /\(\+ sidecar apple_card-september\.csv\.context\.json\)/);
  assert.equal(readCommandLog(harness), "");
  assert.equal(existsSync(filePath), true);
  assert.equal(existsSync(`${filePath}.context.json`), true);
});

test(".env.local supplies the landing bucket and import user id", () => {
  const harness = createScriptHarness();
  const filePath = writeDropboxFile(harness, "chase-activity.csv");
  writeFileSync(`${filePath}.context.json`, '{"sourceAccountId":"checking"}\n', "utf8");
  writeFileSync(
    join(harness.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = runDropboxScript(harness, ["--no-dataform"], {
    WAREHOUSE_IMPORT_USER_ID: "",
    WAREHOUSE_LANDING_BUCKET: "",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bucket: gs:\/\/env-bucket/);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner/);

  const uploadedCsvPath = join(
    harness.dropboxDir,
    "_uploaded/2026-09-18/chase-activity.csv",
  );
  assert.equal(existsSync(filePath), false);
  assert.equal(existsSync(uploadedCsvPath), true);
  assert.equal(existsSync(`${uploadedCsvPath}.context.json`), true);

  const commandLog = readCommandLog(harness);
  assert.match(
    commandLog,
    /gcloud \[storage\] \[cp\] \[.*chase-activity\.csv\] \[gs:\/\/env-bucket\/incoming\/chase\/2026\/09\/18\/chase-activity\.csv\]/,
  );
  assert.match(
    commandLog,
    /gcloud \[storage\] \[cp\] \[.*chase-activity\.csv\.context\.json\] \[gs:\/\/env-bucket\/incoming\/chase\/2026\/09\/18\/chase-activity\.csv\.context\.json\]/,
  );
  assert.match(
    commandLog,
    /npm \[run\] \[etl:runner\] \[--\] \[--gcs-bucket\] \[env-bucket\] \[--max-files\] \[50\] \[--user-id\] \[env-user\]/,
  );
  assert.doesNotMatch(commandLog, /^npx /m);
});

test("CLI --user-id takes precedence over .env.local", () => {
  const harness = createScriptHarness();
  writeDropboxFile(harness, "capital_one-checking.csv");
  writeFileSync(
    join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\n",
    "utf8",
  );

  const result = runDropboxScript(harness, ["--no-dataform", "--user-id", "cli-user"], {
    WAREHOUSE_IMPORT_USER_ID: "",
  });

  assert.equal(result.status, 0, result.stderr);

  const commandLog = readCommandLog(harness);
  assert.match(commandLog, /\[--user-id\] \[cli-user\]/);
  assert.doesNotMatch(commandLog, /\[--user-id\] \[env-user\]/);
});
