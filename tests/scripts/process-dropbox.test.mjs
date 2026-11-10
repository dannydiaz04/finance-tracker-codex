import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const callLogPath = join(root, "calls.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

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
  writeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash
printf 'gcloud|%s\\n' "$*" >> "$CALL_LOG"
`,
  );
  writeExecutable(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash
printf 'npm|%s\\n' "$*" >> "$CALL_LOG"
`,
  );
  writeExecutable(
    join(binDirectory, "npx"),
    `#!/usr/bin/env bash
printf 'npx|%s\\n' "$*" >> "$CALL_LOG"
`,
  );

  return {
    root,
    scriptPath,
    dropboxDirectory,
    callLogPath,
    env: {
      ...process.env,
      CALL_LOG: callLogPath,
      PATH: `${binDirectory}:${process.env.PATH}`,
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runScript(sandbox, args = [], envOverrides = {}) {
  const env = {
    ...sandbox.env,
    ...envOverrides,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  Object.assign(env, envOverrides);

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env,
    encoding: "utf8",
  });
}

function writeDropboxCsv(sandbox, fileName = "chase-activity.csv") {
  const filePath = join(sandbox.dropboxDirectory, fileName);
  writeFileSync(filePath, "posted_at,description,amount\n2026-04-13,Coffee,-4.50\n", "utf8");
  return filePath;
}

function readCallLog(sandbox) {
  return existsSync(sandbox.callLogPath)
    ? readFileSync(sandbox.callLogPath, "utf8").trim().split("\n").filter(Boolean)
    : [];
}

test("Dropbox ingest refuses non-dry-run processing without a user id before side effects", () => {
  const sandbox = createSandbox();
  try {
    const csvPath = writeDropboxCsv(sandbox);

    const result = runScript(sandbox, ["--no-dataform"]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Refusing to ingest without a user id/);
    assert.deepEqual(readCallLog(sandbox), []);
    assert.equal(existsSync(csvPath), true);
    assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
  } finally {
    sandbox.cleanup();
  }
});

test("Dropbox ingest dry run previews files without requiring credentials or moving files", () => {
  const sandbox = createSandbox();
  try {
    const csvPath = writeDropboxCsv(sandbox, "capital_one-checking.csv");
    const sidecarPath = `${csvPath}.context.json`;
    writeFileSync(sidecarPath, '{"accountName":"Checking"}\n', "utf8");

    const result = runScript(sandbox, ["--dry-run"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /capital_one-checking\.csv\s+->\s+capital_one/);
    assert.match(result.stdout, /\(\+ sidecar capital_one-checking\.csv\.context\.json\)/);
    assert.match(result.stdout, /Dry run complete/);
    assert.deepEqual(readCallLog(sandbox), []);
    assert.equal(existsSync(csvPath), true);
    assert.equal(existsSync(sidecarPath), true);
    assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
  } finally {
    sandbox.cleanup();
  }
});

test("Dropbox ingest loads .env.local user and bucket defaults before forwarding to the ETL runner", () => {
  const sandbox = createSandbox();
  try {
    const csvPath = writeDropboxCsv(sandbox, "discover-export.csv");
    const sidecarPath = `${csvPath}.context.json`;
    writeFileSync(sidecarPath, '{"sourceAccountId":"discover-card"}\n', "utf8");
    writeFileSync(
      join(sandbox.root, ".env.local"),
      'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
      "utf8",
    );

    const result = runScript(sandbox, ["--no-dataform"]);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readCallLog(sandbox), [
      "gcloud|storage cp " +
        `${csvPath} gs://env-bucket/incoming/discover/2026/04/13/discover-export.csv`,
      "gcloud|storage cp " +
        `${sidecarPath} gs://env-bucket/incoming/discover/2026/04/13/discover-export.csv.context.json`,
      "npm|run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user",
    ]);
    assert.equal(existsSync(csvPath), false);
    assert.equal(existsSync(sidecarPath), false);
    assert.equal(
      existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/discover-export.csv")),
      true,
    );
    assert.equal(
      existsSync(
        join(sandbox.dropboxDirectory, "_uploaded/2026-04-13/discover-export.csv.context.json"),
      ),
      true,
    );
  } finally {
    sandbox.cleanup();
  }
});

test("Dropbox ingest lets the CLI user id override env defaults and preserves max-file limits", () => {
  const sandbox = createSandbox();
  try {
    const csvPath = writeDropboxCsv(sandbox, "manual.transactions.csv");

    const result = runScript(
      sandbox,
      ["--no-dataform", "--user-id", "cli-user"],
      {
        WAREHOUSE_IMPORT_USER_ID: "env-user",
        WAREHOUSE_LANDING_BUCKET: "env-bucket",
        ETL_MAX_FILES: "7",
      },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readCallLog(sandbox), [
      "gcloud|storage cp " +
        `${csvPath} gs://env-bucket/incoming/manual/2026/04/13/manual.transactions.csv`,
      "npm|run etl:runner -- --gcs-bucket env-bucket --max-files 7 --user-id cli-user",
    ]);
  } finally {
    sandbox.cleanup();
  }
});
