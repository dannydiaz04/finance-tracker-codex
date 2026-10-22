import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const realScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o755 });
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const callsLog = join(root, "calls.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  symlinkSync(realScriptPath, join(scriptsDir, "process-dropbox.sh"));

  writeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /bin/date "$@" ;;
esac
`,
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binDir, command),
      `#!/usr/bin/env bash
printf '${command}' >> "$CALL_LOG"
for arg in "$@"; do
  printf ' %s' "$arg" >> "$CALL_LOG"
done
printf '\\n' >> "$CALL_LOG"
`,
    );
  }

  return {
    root,
    dropboxDir,
    callsLog,
    scriptPath: join(scriptsDir, "process-dropbox.sh"),
    env: {
      ...process.env,
      CALL_LOG: callsLog,
      PATH: `${binDir}:${process.env.PATH}`,
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

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env,
    encoding: "utf8",
  });
}

function readCalls(sandbox) {
  return existsSync(sandbox.callsLog)
    ? readFileSync(sandbox.callsLog, "utf8")
    : "";
}

test("real ingest refuses to run without a user id before upload or ETL side effects", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");

  const result = runScript(sandbox);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(readCalls(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(join(sandbox.dropboxDir, "_uploaded")), false);
});

test("dry run remains safe without a user id and does not move or process files", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "mystery-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "date,description,amount\n2026-04-13,Coffee,-4.50\n");
  writeFileSync(sidecarPath, '{"accountName":"Manual CSV"}\n');

  const result = runScript(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /mystery-export\.csv\s+->\s+manual/);
  assert.match(result.stdout, /\(\+ sidecar mystery-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(readCalls(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
  assert.equal(existsSync(join(sandbox.dropboxDir, "_uploaded")), false);
});

test("env-local user and bucket defaults are used for upload, archive, and ETL", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-04-13,Payroll,100.00\n");
  writeFileSync(sidecarPath, '{"sourceAccountId":"capital_one_checking"}\n');
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
  );

  const result = runScript(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)/);
  assert.equal(
    readCalls(sandbox),
    [
      `gcloud storage cp ${csvPath} gs://env-bucket/incoming/capital_one/2026/04/13/capital_one-checking.csv`,
      `gcloud storage cp ${sidecarPath} gs://env-bucket/incoming/capital_one/2026/04/13/capital_one-checking.csv.context.json`,
      "npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user-123",
      "",
    ].join("\n"),
  );
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.equal(
    existsSync(join(sandbox.dropboxDir, "_uploaded/2026-04-13/capital_one-checking.csv")),
    true,
  );
  assert.equal(
    existsSync(
      join(sandbox.dropboxDir, "_uploaded/2026-04-13/capital_one-checking.csv.context.json"),
    ),
    true,
  );
});

test("CLI user id overrides env-local defaults when invoking the ETL runner", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDir, "discover-export.csv");
  writeFileSync(csvPath, "Trans. Date,Post Date,Description,Amount,Category\n04/13/2026,04/13/2026,Coffee,-4.50,Food\n");
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user-123\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
  );

  const result = runScript(sandbox, [
    "--user-id",
    "cli-user-456",
    "--no-dataform",
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readCalls(sandbox),
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user-456/,
  );
});
