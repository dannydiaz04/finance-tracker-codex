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
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const scriptSource = readFileSync(
  join(repoRoot, "scripts/process-dropbox.sh"),
  "utf8",
);

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createScriptFixture({ envLocal } = {}) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-script-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const fakeBinDir = join(root, "fakebin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  writeExecutable(join(scriptsDir, "process-dropbox.sh"), scriptSource);

  if (envLocal) {
    writeFileSync(join(root, ".env.local"), envLocal, "utf8");
  }

  writeExecutable(
    join(fakeBinDir, "gcloud"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DROPBOX_TEST_LOG_DIR/gcloud.log"
if [[ "$1" == "storage" && "$2" == "cp" ]]; then
  exit 0
fi
echo "unexpected gcloud args: $*" >&2
exit 7
`,
  );

  writeExecutable(
    join(fakeBinDir, "npm"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$DROPBOX_TEST_LOG_DIR/npm.log"
exit 0
`,
  );

  return { root, dropboxDir, fakeBinDir };
}

function runProcessDropbox(fixture, args = [], envOverrides = {}) {
  const env = { ...process.env };
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  Object.assign(env, envOverrides);
  env.DROPBOX_TEST_LOG_DIR = fixture.root;
  env.PATH = `${fixture.fakeBinDir}:${process.env.PATH}`;

  return spawnSync(
    "bash",
    [join(fixture.root, "scripts/process-dropbox.sh"), ...args],
    {
      cwd: fixture.root,
      env,
      encoding: "utf8",
    },
  );
}

test("process-dropbox refuses real ingest without a user id", () => {
  const fixture = createScriptFixture();
  const csvPath = join(fixture.dropboxDir, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");

  const result = runProcessDropbox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(fixture.root, "gcloud.log")), false);
  assert.equal(existsSync(join(fixture.root, "npm.log")), false);
});

test("process-dropbox dry run is allowed without a user id and leaves files in place", () => {
  const fixture = createScriptFixture();
  const csvPath = join(fixture.dropboxDir, "Apple_Card-April.csv");
  const contextPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-04-13,Snack,-6.25\n");
  writeFileSync(contextPath, '{"sourceAccountId":"apple-card"}\n');

  const result = runProcessDropbox(fixture, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Apple_Card-April\.csv\s+->\s+apple_card/);
  assert.match(result.stdout, /\(\+ sidecar Apple_Card-April\.csv\.context\.json\)/);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(contextPath), true);
  assert.equal(existsSync(join(fixture.dropboxDir, "_uploaded")), false);
  assert.equal(existsSync(join(fixture.root, "gcloud.log")), false);
  assert.equal(existsSync(join(fixture.root, "npm.log")), false);
});

test("process-dropbox reads env-local user id and bucket before running ETL", () => {
  const fixture = createScriptFixture({
    envLocal: [
      'WAREHOUSE_IMPORT_USER_ID="user-from-env"',
      "WAREHOUSE_LANDING_BUCKET='bucket-from-env'",
      "",
    ].join("\n"),
  });
  const csvPath = join(fixture.dropboxDir, "discover-export.csv");
  writeFileSync(csvPath, "Trans. Date,Post Date,Description,Amount\n4/13/26,4/13/26,Market,-12.34\n");

  const result = runProcessDropbox(fixture, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner/);

  const gcloudLog = readFileSync(join(fixture.root, "gcloud.log"), "utf8");
  assert.match(
    gcloudLog,
    /storage cp .*discover-export\.csv gs:\/\/bucket-from-env\/incoming\/discover\//,
  );

  const npmLog = readFileSync(join(fixture.root, "npm.log"), "utf8");
  assert.match(
    npmLog,
    /run etl:runner -- --gcs-bucket bucket-from-env --max-files 50 --user-id user-from-env/,
  );

  assert.equal(existsSync(csvPath), false);
  const uploadedDates = readdirSync(join(fixture.dropboxDir, "_uploaded"));
  assert.equal(uploadedDates.length, 1);
  assert.equal(
    existsSync(join(fixture.dropboxDir, "_uploaded", uploadedDates[0], "discover-export.csv")),
    true,
  );
});
