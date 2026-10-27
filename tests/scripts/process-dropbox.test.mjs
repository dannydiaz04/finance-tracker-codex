import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents);
  chmodSync(filePath, 0o755);
}

function createIsolatedRepo(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-dropbox-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(root, "scripts"), { recursive: true });
  symlinkSync(sourceScriptPath, join(root, "scripts/process-dropbox.sh"));
  mkdirSync(join(root, "dropbox"), { recursive: true });

  const bin = join(root, "bin");
  mkdirSync(bin);
  writeExecutable(
    join(bin, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) exec /usr/bin/date "$@" ;;
esac
`,
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(bin, command),
      `#!/usr/bin/env bash
{
  printf '${command}'
  for arg in "$@"; do
    printf ' <%s>' "$arg"
  done
  printf '\\n'
} >> "$TEST_COMMAND_LOG"
`,
    );
  }

  return root;
}

function runDropbox(root, args = [], overrides = {}) {
  const env = {
    ...process.env,
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    TEST_COMMAND_LOG: join(root, "commands.log"),
  };
  delete env.ETL_MAX_FILES;
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  Object.assign(env, overrides);

  return spawnSync("bash", [join(root, "scripts/process-dropbox.sh"), ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}

test("refuses real ingest without a user id before cloud or ETL side effects", (t) => {
  const root = createIsolatedRepo(t);
  const csvPath = join(root, "dropbox/chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");

  const result = runDropbox(root, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(existsSync(join(root, "commands.log")), false);
  assert.equal(existsSync(csvPath), true);
});

test("allows dry-run inspection without a user id and without side effects", (t) => {
  const root = createIsolatedRepo(t);
  const csvPath = join(root, "dropbox/discover-export.csv");
  writeFileSync(csvPath, "Trans. Date,Description,Amount\n04/13/2026,Coffee,-4.50\n");

  const result = runDropbox(root, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/discover\/2026\/04\/13\/discover-export\.csv/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(existsSync(join(root, "commands.log")), false);
  assert.equal(existsSync(csvPath), true);
});

test(".env.local supplies the ingest user and landing bucket for uploads and runner args", (t) => {
  const root = createIsolatedRepo(t);
  const csvPath = join(root, "dropbox/chase-activity.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");
  writeFileSync(sidecarPath, '{"sourceAccountId":"chase_card"}\n');
  writeFileSync(
    join(root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=\'env-landing-bucket\'\n',
  );

  const result = runDropbox(root, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  const destination =
    "gs://env-landing-bucket/incoming/chase/2026/04/13/chase-activity.csv";
  assert.deepEqual(readFileSync(join(root, "commands.log"), "utf8").trim().split("\n"), [
    `gcloud <storage> <cp> <${csvPath}> <${destination}>`,
    `gcloud <storage> <cp> <${sidecarPath}> <${destination}.context.json>`,
    "npm <run> <etl:runner> <--> <--gcs-bucket> <env-landing-bucket> <--max-files> <50> <--user-id> <env-user-123>",
  ]);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(root, "dropbox/_uploaded/2026-04-13/chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(join(root, "dropbox/_uploaded/2026-04-13/chase-activity.csv.context.json")),
    true,
  );
});
