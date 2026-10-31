import assert from "node:assert/strict";
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
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const scriptSource = readFileSync(
  join(repoRoot, "scripts/process-dropbox.sh"),
  "utf8",
);

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function createHarness(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "finance-dropbox-script-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const commandLog = join(root, "commands.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  writeExecutable(scriptPath, scriptSource);

  if (options.envLocal) {
    writeFileSync(join(root, ".env.local"), options.envLocal, "utf8");
  }

  writeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) printf '2026\\n' ;;
  +%m) printf '04\\n' ;;
  +%d) printf '13\\n' ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );
  writeExecutable(
    join(binDir, "gcloud"),
    `#!/usr/bin/env bash
printf 'gcloud %s\\n' "$*" >> "$COMMAND_LOG"
`,
  );
  writeExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
printf 'npm %s\\n' "$*" >> "$COMMAND_LOG"
`,
  );
  writeExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
printf 'npx %s\\n' "$*" >> "$COMMAND_LOG"
`,
  );

  return {
    binDir,
    commandLog,
    dropboxDir,
    root,
    scriptPath,
  };
}

function writeCsv(harness, name = "chase-activity.csv") {
  const csvPath = join(harness.dropboxDir, name);
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-12,Coffee,-4.50\n");
  return csvPath;
}

function runProcessDropbox(harness, args = [], env = {}) {
  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    encoding: "utf8",
    env: {
      ...process.env,
      COMMAND_LOG: harness.commandLog,
      ETL_MAX_FILES: "",
      PATH: `${harness.binDir}:${process.env.PATH}`,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
  });
}

function readCommandLog(harness) {
  return existsSync(harness.commandLog)
    ? readFileSync(harness.commandLog, "utf8")
    : "";
}

test("dropbox ingest refuses non-dry-run imports without a user id before side effects", () => {
  const harness = createHarness();
  const csvPath = writeCsv(harness);

  const result = runProcessDropbox(harness);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.equal(readCommandLog(harness), "");
  assert.equal(existsSync(csvPath), true);
});

test("dropbox ingest dry run remains safe without credentials or a user id", () => {
  const harness = createHarness();
  const csvPath = writeCsv(harness, "discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n');

  const result = runProcessDropbox(harness, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /discover-export\.csv  ->  discover/);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/discover\/2026\/04\/13\/discover-export\.csv/,
  );
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCommandLog(harness), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("dropbox ingest loads env defaults, uploads sidecars, archives files, and forwards user id", () => {
  const harness = createHarness({
    envLocal: [
      'WAREHOUSE_IMPORT_USER_ID="env-user"',
      "WAREHOUSE_LANDING_BUCKET='env-bucket'",
      "",
    ].join("\n"),
  });
  const csvPath = writeCsv(harness, "capital_one-checking.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Capital One"}\n');

  const result = runProcessDropbox(harness, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);
  assert.equal(
    existsSync(
      join(harness.dropboxDir, "_uploaded/2026-04-13/capital_one-checking.csv"),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(
        harness.dropboxDir,
        "_uploaded/2026-04-13/capital_one-checking.csv.context.json",
      ),
    ),
    true,
  );

  const log = readCommandLog(harness);
  assert.match(
    log,
    new RegExp(
      `gcloud storage cp ${csvPath} gs://env-bucket/incoming/capital_one/2026/04/13/capital_one-checking\\.csv`,
    ),
  );
  assert.match(
    log,
    new RegExp(
      `gcloud storage cp ${csvPath}\\.context\\.json gs://env-bucket/incoming/capital_one/2026/04/13/capital_one-checking\\.csv\\.context\\.json`,
    ),
  );
  assert.match(
    log,
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );
  assert.doesNotMatch(log, /npx dataform run dataform/);
});

test("dropbox ingest lets an explicit CLI user id override .env.local", () => {
  const harness = createHarness({
    envLocal: [
      "WAREHOUSE_IMPORT_USER_ID=env-user",
      "WAREHOUSE_LANDING_BUCKET=env-bucket",
      "",
    ].join("\n"),
  });
  writeCsv(harness, "chase-activity.csv");

  const result = runProcessDropbox(harness, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readCommandLog(harness),
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user/,
  );
});
