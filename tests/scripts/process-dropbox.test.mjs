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
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const realScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function makeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createHarness({ envLocal = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));

  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "dropbox"), { recursive: true });
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(realScriptPath, join(root, "scripts/process-dropbox.sh"));

  makeExecutable(
    join(root, "bin/date"),
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
    join(root, "bin/gcloud"),
    `#!/usr/bin/env bash
echo "gcloud $*" >> "$FAKE_COMMAND_LOG"
`,
  );
  makeExecutable(
    join(root, "bin/npm"),
    `#!/usr/bin/env bash
echo "npm $*" >> "$FAKE_COMMAND_LOG"
`,
  );

  if (envLocal) {
    writeFileSync(join(root, ".env.local"), envLocal, "utf8");
  }

  return root;
}

function writeDropboxFile(root, fileName, contents = "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n") {
  const filePath = join(root, "dropbox", fileName);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function runProcessDropbox(root, args = [], extraEnv = {}) {
  const env = { ...process.env };
  delete env.ETL_MAX_FILES;
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;

  return spawnSync("bash", [join(root, "scripts/process-dropbox.sh"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...env,
      ...extraEnv,
      FAKE_COMMAND_LOG: join(root, "commands.log"),
      PATH: `${join(root, "bin")}:${env.PATH}`,
    },
  });
}

function readCommandLog(root) {
  const logPath = join(root, "commands.log");
  return existsSync(logPath) ? readFileSync(logPath, "utf8").trim().split("\n") : [];
}

test("refuses real Dropbox ingest without a user id before upload side effects", () => {
  const root = createHarness();
  const csvPath = writeDropboxFile(root, "chase-activity.csv");

  const result = runProcessDropbox(root, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(root, "dropbox/_uploaded")), false);
  assert.deepEqual(readCommandLog(root), []);
});

test("dry run remains safe without a user id and does not move sidecar files", () => {
  const root = createHarness();
  const csvPath = writeDropboxFile(root, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"sourceAccountId":"discover_card"}\n', "utf8");

  const result = runProcessDropbox(root, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
  assert.deepEqual(readCommandLog(root), []);
});

test("loads user id and bucket from .env.local, uploads sidecars, archives files, and scopes the runner", () => {
  const root = createHarness({
    envLocal: [
      'WAREHOUSE_IMPORT_USER_ID="user-env"',
      "WAREHOUSE_LANDING_BUCKET='custom-landing-bucket'",
      "",
    ].join("\n"),
  });
  const csvPath = writeDropboxFile(root, "apple_card-april.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, '{"sourceAccountId":"apple_card"}\n', "utf8");

  const result = runProcessDropbox(root, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readCommandLog(root), [
    `gcloud storage cp ${csvPath} gs://custom-landing-bucket/incoming/apple_card/2026/04/13/apple_card-april.csv`,
    `gcloud storage cp ${sidecarPath} gs://custom-landing-bucket/incoming/apple_card/2026/04/13/apple_card-april.csv.context.json`,
    "npm run etl:runner -- --gcs-bucket custom-landing-bucket --max-files 50 --user-id user-env",
  ]);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(root, "dropbox/_uploaded/2026-04-13/apple_card-april.csv")),
    true,
  );
  assert.equal(
    existsSync(join(root, "dropbox/_uploaded/2026-04-13/apple_card-april.csv.context.json")),
    true,
  );
});

test("command line user id overrides .env.local when forwarding to the runner", () => {
  const root = createHarness({
    envLocal: 'WAREHOUSE_IMPORT_USER_ID="user-env"\n',
  });
  writeDropboxFile(root, "capital_one-checking.csv");

  const result = runProcessDropbox(root, ["--no-dataform", "--user-id", "user-cli"]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    readCommandLog(root).at(-1),
    "npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 50 --user-id user-cli",
  );
});
