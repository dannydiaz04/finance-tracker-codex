import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
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
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const callLogPath = join(root, "calls.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  cpSync(sourceScriptPath, join(scriptsDir, "process-dropbox.sh"));

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
printf 'gcloud:%s\\n' "$*" >> "$CALL_LOG"
`,
  );
  writeExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
printf 'npm:%s\\n' "$*" >> "$CALL_LOG"
`,
  );
  writeExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
printf 'npx:%s\\n' "$*" >> "$CALL_LOG"
`,
  );

  return {
    root,
    dropboxDir,
    callLogPath,
    scriptPath: join(scriptsDir, "process-dropbox.sh"),
    env: {
      ...process.env,
      CALL_LOG: callLogPath,
      PATH: `${binDir}:${process.env.PATH}`,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function runDropbox(sandbox, args = []) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env: sandbox.env,
    encoding: "utf8",
  });
}

function readCallLog(sandbox) {
  return existsSync(sandbox.callLogPath)
    ? readFileSync(sandbox.callLogPath, "utf8")
    : "";
}

test("real Dropbox ingest refuses to run without a user id before side effects", () => {
  const sandbox = createSandbox();
  try {
    const csvPath = join(sandbox.dropboxDir, "chase-activity.csv");
    writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n");

    const result = runDropbox(sandbox, ["--no-dataform"]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Refusing to ingest without a user id/);
    assert.equal(readCallLog(sandbox), "");
    assert.equal(existsSync(csvPath), true);
    assert.equal(existsSync(join(sandbox.dropboxDir, "_uploaded")), false);
  } finally {
    sandbox.cleanup();
  }
});

test("dry-run previews Dropbox files without requiring credentials or moving files", () => {
  const sandbox = createSandbox();
  try {
    const csvPath = join(sandbox.dropboxDir, "discover-export.csv");
    writeFileSync(csvPath, "Trans. Date,Description,Amount\n04/13/2026,Book,-12.00\n");
    writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n');

    const result = runDropbox(sandbox, ["--dry-run"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
    assert.match(result.stdout, /sidecar discover-export\.csv\.context\.json/);
    assert.equal(readCallLog(sandbox), "");
    assert.equal(existsSync(csvPath), true);
    assert.equal(existsSync(`${csvPath}.context.json`), true);
  } finally {
    sandbox.cleanup();
  }
});

test("Dropbox ingest loads .env.local user and bucket defaults before processing", () => {
  const sandbox = createSandbox();
  try {
    const csvPath = join(sandbox.dropboxDir, "chase-activity.csv");
    writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n");
    writeFileSync(`${csvPath}.context.json`, '{"accountName":"Chase"}\n');
    writeFileSync(
      join(sandbox.root, ".env.local"),
      'WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET="custom-bucket"\n',
    );

    const result = runDropbox(sandbox, ["--no-dataform"]);

    assert.equal(result.status, 0, result.stderr);

    const callLog = readCallLog(sandbox);
    assert.match(
      callLog,
      /gcloud:storage cp .*chase-activity\.csv gs:\/\/custom-bucket\/incoming\/chase\/2026\/04\/13\/chase-activity\.csv/,
    );
    assert.match(
      callLog,
      /gcloud:storage cp .*chase-activity\.csv\.context\.json gs:\/\/custom-bucket\/incoming\/chase\/2026\/04\/13\/chase-activity\.csv\.context\.json/,
    );
    assert.match(
      callLog,
      /npm:run etl:runner -- --gcs-bucket custom-bucket --max-files 50 --user-id env-user/,
    );
    assert.doesNotMatch(callLog, /^npx:/m);
    assert.equal(
      existsSync(join(sandbox.dropboxDir, "_uploaded/2026-04-13/chase-activity.csv")),
      true,
    );
    assert.equal(
      existsSync(
        join(sandbox.dropboxDir, "_uploaded/2026-04-13/chase-activity.csv.context.json"),
      ),
      true,
    );
  } finally {
    sandbox.cleanup();
  }
});

test("explicit Dropbox ingest user id overrides .env.local", () => {
  const sandbox = createSandbox();
  try {
    writeFileSync(
      join(sandbox.dropboxDir, "capital_one-checking.csv"),
      "Date,Description,Amount\n2026-04-13,Paycheck,100.00\n",
    );
    writeFileSync(
      join(sandbox.root, ".env.local"),
      "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
    );

    const result = runDropbox(sandbox, [
      "--no-dataform",
      "--user-id",
      "cli-user",
    ]);

    assert.equal(result.status, 0, result.stderr);

    const callLog = readCallLog(sandbox);
    assert.match(
      callLog,
      /npm:run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user/,
    );
    assert.doesNotMatch(callLog, /--user-id env-user/);
  } finally {
    sandbox.cleanup();
  }
});
