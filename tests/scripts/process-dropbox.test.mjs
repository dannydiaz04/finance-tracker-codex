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
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function makeFixtureRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(repoRoot, "scripts");
  const dropboxDir = join(repoRoot, "dropbox");
  const binDir = join(repoRoot, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  copyFileSync(sourceScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );
  writeExecutable(
    join(binDir, "gcloud"),
    `#!/usr/bin/env bash
printf 'gcloud %s\\n' "$*" >> "\${TEST_COMMAND_LOG}"
`,
  );
  writeExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
printf 'npm %s\\n' "$*" >> "\${TEST_COMMAND_LOG}"
`,
  );
  writeExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
printf 'npx %s\\n' "$*" >> "\${TEST_COMMAND_LOG}"
`,
  );

  return {
    repoRoot,
    scriptPath,
    dropboxDir,
    commandLog: join(repoRoot, "commands.log"),
    env: {
      PATH: `${binDir}:${process.env.PATH}`,
      TEST_COMMAND_LOG: join(repoRoot, "commands.log"),
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
    },
  };
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function writeCsv(dropboxDir, name = "chase-activity.csv") {
  const csvPath = join(dropboxDir, name);
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-04-01,Coffee,-4.50\n");
  return csvPath;
}

function runProcessDropBox(fixture, args = []) {
  return spawnSync("bash", [fixture.scriptPath, ...args], {
    cwd: fixture.repoRoot,
    env: fixture.env,
    encoding: "utf8",
  });
}

function readCommandLog(fixture) {
  return existsSync(fixture.commandLog)
    ? readFileSync(fixture.commandLog, "utf8")
    : "";
}

test("Dropbox ingest refuses real uploads without a user id before side effects", () => {
  const fixture = makeFixtureRepo();
  const csvPath = writeCsv(fixture.dropboxDir);

  const result = runProcessDropBox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readCommandLog(fixture), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry-run remains safe without credentials", () => {
  const fixture = makeFixtureRepo();
  const csvPath = writeCsv(fixture.dropboxDir, "Chase-April.csv");
  writeFileSync(`${csvPath}.context.json`, '{"sourceAccountId":"chase_card"}\n');

  const result = runProcessDropBox(fixture, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(
    result.stdout,
    /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/chase\/2026\/04\/13\/Chase-April\.csv/,
  );
  assert.match(result.stdout, /\(\+ sidecar Chase-April\.csv\.context\.json\)/);
  assert.equal(readCommandLog(fixture), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("Dropbox ingest loads .env.local defaults, uploads sidecars, archives files, and stamps the ETL user", () => {
  const fixture = makeFixtureRepo();
  const csvPath = writeCsv(fixture.dropboxDir, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"sourceAccountId":"discover_card"}\n');
  writeFileSync(
    join(fixture.repoRoot, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID='env-user'\nWAREHOUSE_LANDING_BUCKET=\"env-bucket\"\n",
  );

  const result = runProcessDropBox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner/);

  const commandLog = readCommandLog(fixture);
  assert.match(
    commandLog,
    /gcloud storage cp .*discover-export\.csv gs:\/\/env-bucket\/incoming\/discover\/2026\/04\/13\/discover-export\.csv/,
  );
  assert.match(
    commandLog,
    /gcloud storage cp .*discover-export\.csv\.context\.json gs:\/\/env-bucket\/incoming\/discover\/2026\/04\/13\/discover-export\.csv\.context\.json/,
  );
  assert.match(
    commandLog,
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );

  const archiveDir = join(fixture.dropboxDir, "_uploaded", "2026-04-13");
  assert.equal(existsSync(join(archiveDir, basename(csvPath))), true);
  assert.equal(existsSync(join(archiveDir, basename(sidecarPath))), true);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
});

test("Dropbox ingest lets the CLI user id override .env.local", () => {
  const fixture = makeFixtureRepo();
  writeCsv(fixture.dropboxDir, "manual.csv");
  writeFileSync(join(fixture.repoRoot, ".env.local"), "WAREHOUSE_IMPORT_USER_ID=env-user\n");

  const result = runProcessDropBox(fixture, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readCommandLog(fixture),
    /npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 50 --user-id cli-user/,
  );
});
