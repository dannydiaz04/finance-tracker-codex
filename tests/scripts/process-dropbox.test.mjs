import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function createScriptRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(repoRoot, "scripts");
  const dropboxDirectory = join(repoRoot, "dropbox");
  const binDirectory = join(repoRoot, "bin");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeExecutable(
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

  return { repoRoot, scriptPath, dropboxDirectory, binDirectory };
}

function writeExecutable(path, contents) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function writeTraceCommand(binDirectory, commandName) {
  writeExecutable(
    join(binDirectory, commandName),
    `#!/usr/bin/env bash
printf '%s' '${commandName}' >> "$TRACE_FILE"
printf ' %q' "$@" >> "$TRACE_FILE"
printf '\\n' >> "$TRACE_FILE"
`,
  );
}

function runDropboxScript(scriptPath, binDirectory, args = [], extraEnv = {}) {
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: dirname(dirname(scriptPath)),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH}`,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...extraEnv,
    },
  });
}

test("process-dropbox refuses non-dry-run ingest without a user id before side effects", () => {
  const { scriptPath, dropboxDirectory, binDirectory, repoRoot } = createScriptRepo();
  const traceFile = join(repoRoot, "trace.log");

  writeFileSync(join(dropboxDirectory, "chase-activity.csv"), "date,description,amount\n", "utf8");
  writeTraceCommand(binDirectory, "gcloud");
  writeTraceCommand(binDirectory, "npm");
  writeTraceCommand(binDirectory, "npx");

  const result = runDropboxScript(scriptPath, binDirectory, ["--no-dataform"], {
    TRACE_FILE: traceFile,
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(existsSync(traceFile), false, "cloud and ETL commands must not run");
  assert.equal(existsSync(join(dropboxDirectory, "chase-activity.csv")), true);
  assert.equal(existsSync(join(dropboxDirectory, "_uploaded")), false);
});

test("process-dropbox dry-run is safe without credentials or a user id", () => {
  const { scriptPath, dropboxDirectory, binDirectory, repoRoot } = createScriptRepo();
  const traceFile = join(repoRoot, "trace.log");

  writeFileSync(join(dropboxDirectory, "Discover-export.csv"), "Trans. Date,Description,Amount\n", "utf8");
  writeFileSync(join(dropboxDirectory, "Discover-export.csv.context.json"), '{"userId":"file-user"}\n', "utf8");
  writeTraceCommand(binDirectory, "gcloud");
  writeTraceCommand(binDirectory, "npm");
  writeTraceCommand(binDirectory, "npx");

  const result = runDropboxScript(scriptPath, binDirectory, ["--dry-run"], {
    TRACE_FILE: traceFile,
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Discover-export\.csv\s+->\s+discover/);
  assert.match(result.stdout, /incoming\/discover\/2026\/04\/13\/Discover-export\.csv/);
  assert.match(result.stdout, /\(\+ sidecar Discover-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(existsSync(traceFile), false, "dry run must not invoke external tools");
  assert.equal(existsSync(join(dropboxDirectory, "Discover-export.csv")), true);
  assert.equal(existsSync(join(dropboxDirectory, "Discover-export.csv.context.json")), true);
});

test("process-dropbox loads .env.local defaults and forwards the user id to the ETL runner", () => {
  const { scriptPath, dropboxDirectory, binDirectory, repoRoot } = createScriptRepo();
  const traceFile = join(repoRoot, "trace.log");

  writeFileSync(
    join(repoRoot, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=landing-bucket\n",
    "utf8",
  );
  writeFileSync(join(dropboxDirectory, "capital_one-checking.csv"), "Transaction Date,Description,Debit,Credit\n", "utf8");
  writeFileSync(join(dropboxDirectory, "capital_one-checking.csv.context.json"), '{"accountName":"Checking"}\n', "utf8");
  writeTraceCommand(binDirectory, "gcloud");
  writeTraceCommand(binDirectory, "npm");
  writeTraceCommand(binDirectory, "npx");

  const result = runDropboxScript(scriptPath, binDirectory, ["--no-dataform"], {
    TRACE_FILE: traceFile,
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bucket: gs:\/\/landing-bucket/);

  const trace = readFileSync(traceFile, "utf8");
  assert.match(
    trace,
    /gcloud storage cp .*capital_one-checking\.csv gs:\/\/landing-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv/,
  );
  assert.match(
    trace,
    /gcloud storage cp .*capital_one-checking\.csv\.context\.json gs:\/\/landing-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv\.context\.json/,
  );
  assert.match(trace, /npm run etl:runner -- --gcs-bucket landing-bucket --max-files 7 --user-id env-user/);
  assert.doesNotMatch(trace, /^npx /m);

  assert.equal(existsSync(join(dropboxDirectory, "capital_one-checking.csv")), false);
  assert.equal(existsSync(join(dropboxDirectory, "capital_one-checking.csv.context.json")), false);
  assert.equal(
    existsSync(join(dropboxDirectory, "_uploaded/2026-04-13/capital_one-checking.csv")),
    true,
  );
  assert.equal(
    existsSync(join(dropboxDirectory, "_uploaded/2026-04-13/capital_one-checking.csv.context.json")),
    true,
  );
});
