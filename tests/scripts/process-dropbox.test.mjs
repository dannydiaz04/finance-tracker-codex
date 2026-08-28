import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const scriptSource = join(process.cwd(), "scripts/process-dropbox.sh");

async function createSandbox() {
  const root = await mkdtemp(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  copyFileSync(scriptSource, scriptPath);
  chmodSync(scriptPath, 0o755);

  const gcloudLog = join(root, "gcloud.log");
  const npmLog = join(root, "npm.log");
  const npxLog = join(root, "npx.log");

  writeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) printf '2026\\n' ;;
  +%m) printf '04\\n' ;;
  +%d) printf '13\\n' ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  writeExecutable(
    join(binDir, "gcloud"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_GCLOUD_LOG"
`,
  );
  writeExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_NPM_LOG"
`,
  );
  writeExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_NPX_LOG"
exit 99
`,
  );

  function run(args = [], envOverrides = {}) {
    return spawnSync("bash", [scriptPath, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        HOME: root,
        PATH: `${binDir}:${process.env.PATH ?? ""}`,
        TMPDIR: tmpdir(),
        FAKE_GCLOUD_LOG: gcloudLog,
        FAKE_NPM_LOG: npmLog,
        FAKE_NPX_LOG: npxLog,
        ...envOverrides,
      },
    });
  }

  return {
    root,
    dropboxDir,
    gcloudLog,
    npmLog,
    npxLog,
    run,
  };
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function writeCsv(dropboxDir, fileName = "chase-activity.csv") {
  const filePath = join(dropboxDir, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-12,Coffee,-4.50\n", "utf8");
  return filePath;
}

function readLog(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

test("process-dropbox refuses real ingestion without an import user id", async () => {
  const sandbox = await createSandbox();
  writeCsv(sandbox.dropboxDir);

  const result = sandbox.run(["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(readLog(sandbox.gcloudLog), "");
  assert.equal(readLog(sandbox.npmLog), "");
});

test("process-dropbox dry run remains safe without an import user id", async () => {
  const sandbox = await createSandbox();
  const csvPath = writeCsv(sandbox.dropboxDir, "discover-export.csv");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

  const result = sandbox.run(["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /discover-export\.csv  ->  discover/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(existsSync(csvPath), true);
  assert.equal(readLog(sandbox.gcloudLog), "");
  assert.equal(readLog(sandbox.npmLog), "");
});

test("process-dropbox loads .env.local user and bucket before running the ETL", async () => {
  const sandbox = await createSandbox();
  writeCsv(sandbox.dropboxDir, "capital_one-checking.csv");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="user-from-env"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );

  const result = sandbox.run(["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner against the bucket/);
  assert.match(
    readLog(sandbox.gcloudLog),
    new RegExp(
      `storage cp ${escapeRegExp(
        join(sandbox.dropboxDir, "capital_one-checking.csv"),
      )} gs://env-bucket/incoming/capital_one/2026/04/13/capital_one-checking\\.csv`,
    ),
  );
  assert.equal(
    readLog(sandbox.npmLog).trim(),
    "run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id user-from-env",
  );
  assert.equal(
    existsSync(
      join(sandbox.dropboxDir, "_uploaded/2026-04-13/capital_one-checking.csv"),
    ),
    true,
  );
  assert.equal(readLog(sandbox.npxLog), "");
});

test("process-dropbox forwards explicit user id over environment defaults", async () => {
  const sandbox = await createSandbox();
  writeCsv(sandbox.dropboxDir, "apple_card-statement.csv");

  const result = sandbox.run(["--no-dataform", "--user-id", "cli-user"], {
    WAREHOUSE_IMPORT_USER_ID: "env-user",
    WAREHOUSE_LANDING_BUCKET: "cli-test-bucket",
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readLog(sandbox.gcloudLog),
    /gs:\/\/cli-test-bucket\/incoming\/apple_card\/2026\/04\/13\/apple_card-statement\.csv/,
  );
  assert.equal(
    readLog(sandbox.npmLog).trim(),
    "run etl:runner -- --gcs-bucket cli-test-bucket --max-files 7 --user-id cli-user",
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
