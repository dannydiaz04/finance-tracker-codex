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

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function makeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createHarness() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(repoRoot, "scripts");
  const dropboxDirectory = join(repoRoot, "dropbox");
  const binDirectory = join(repoRoot, "bin");
  const commandLog = join(repoRoot, "commands.log");
  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  copyFileSync(sourceScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  makeExecutable(
    join(binDirectory, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  makeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash
printf 'gcloud %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
`,
  );
  makeExecutable(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash
printf 'npm %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
`,
  );
  makeExecutable(
    join(binDirectory, "npx"),
    `#!/usr/bin/env bash
printf 'npx %s\\n' "$*" >> "$FAKE_COMMAND_LOG"
`,
  );

  return {
    repoRoot,
    dropboxDirectory,
    commandLog,
    scriptPath,
    env: {
      FAKE_COMMAND_LOG: commandLog,
      PATH: `${binDirectory}:${process.env.PATH}`,
    },
  };
}

function runDropboxProcessor(harness, args = [], envOverrides = {}) {
  const env = { ...process.env, ...harness.env };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  Object.assign(env, envOverrides);

  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.repoRoot,
    encoding: "utf8",
    env,
  });
}

function writeDropboxCsv(harness, fileName = "chase-activity.csv") {
  const filePath = join(harness.dropboxDirectory, fileName);

  writeFileSync(filePath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");

  return filePath;
}

test("Dropbox processor refuses non-dry-run ingest without a user id before side effects", () => {
  const harness = createHarness();
  const filePath = writeDropboxCsv(harness);

  const result = runDropboxProcessor(harness);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.equal(existsSync(harness.commandLog), false);
  assert.equal(existsSync(filePath), true);
  assert.equal(existsSync(join(harness.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox processor dry run stays safe without a user id", () => {
  const harness = createHarness();
  const filePath = writeDropboxCsv(harness, "discover-export.csv");
  writeFileSync(`${filePath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

  const result = runDropboxProcessor(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.equal(existsSync(harness.commandLog), false);
  assert.equal(existsSync(filePath), true);
  assert.equal(existsSync(`${filePath}.context.json`), true);
});

test("Dropbox processor loads env defaults, uploads sidecars, archives files, and forwards user id", () => {
  const harness = createHarness();
  const filePath = writeDropboxCsv(harness, "chase-activity.csv");
  writeFileSync(`${filePath}.context.json`, '{"accountName":"Chase"}\n', "utf8");
  writeFileSync(
    join(harness.repoRoot, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=\'custom-bucket\'\n',
    "utf8",
  );

  const result = runDropboxProcessor(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);

  const commands = readFileSync(harness.commandLog, "utf8");
  assert.match(
    commands,
    new RegExp(
      `gcloud storage cp ${filePath} gs://custom-bucket/incoming/chase/2026/04/13/chase-activity\\.csv`,
    ),
  );
  assert.match(
    commands,
    new RegExp(
      `gcloud storage cp ${filePath}\\.context\\.json gs://custom-bucket/incoming/chase/2026/04/13/chase-activity\\.csv\\.context\\.json`,
    ),
  );
  assert.match(
    commands,
    /npm run etl:runner -- --gcs-bucket custom-bucket --max-files 50 --user-id env-user/,
  );
  assert.doesNotMatch(commands, /^npx /m);
  assert.equal(existsSync(filePath), false);
  assert.equal(existsSync(`${filePath}.context.json`), false);
  assert.equal(
    existsSync(join(harness.dropboxDirectory, "_uploaded/2026-04-13/chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(harness.dropboxDirectory, "_uploaded/2026-04-13/chase-activity.csv.context.json"),
    ),
    true,
  );
});

test("Dropbox processor lets a CLI user id override the env default", () => {
  const harness = createHarness();
  writeDropboxCsv(harness, "manual-upload.csv");
  writeFileSync(
    join(harness.repoRoot, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\n",
    "utf8",
  );

  const result = runDropboxProcessor(harness, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr);

  const commands = readFileSync(harness.commandLog, "utf8");
  assert.match(
    commands,
    /npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 50 --user-id cli-user/,
  );
  assert.doesNotMatch(commands, /--user-id env-user/);
});
