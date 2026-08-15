import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const processDropboxScript = readFileSync(
  join(process.cwd(), "scripts/process-dropbox.sh"),
  "utf8",
);

function createIsolatedRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(repoRoot, "scripts");
  const dropboxDir = join(repoRoot, "dropbox");
  const binDir = join(repoRoot, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  writeFileSync(scriptPath, processDropboxScript, "utf8");
  chmodSync(scriptPath, 0o755);

  return { repoRoot, scriptPath, dropboxDir, binDir };
}

function writeStubCommand(binDir, name, body) {
  const commandPath = join(binDir, name);

  writeFileSync(commandPath, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, "utf8");
  chmodSync(commandPath, 0o755);
}

function runProcessDropbox({ scriptPath, binDir, args = [], env = {} }) {
  return spawnSync("bash", [scriptPath, ...args], {
    cwd: join(scriptPath, "..", ".."),
    env: {
      ...process.env,
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
      ETL_MAX_FILES: "",
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
    encoding: "utf8",
  });
}

test("process-dropbox refuses real ingest without a user id", () => {
  const { scriptPath, dropboxDir, binDir } = createIsolatedRepo();
  const droppedFile = join(dropboxDir, "discover-export.csv");

  writeFileSync(droppedFile, "Date,Description,Amount\n", "utf8");
  writeStubCommand(binDir, "gcloud", "echo gcloud should not run >&2\nexit 99");
  writeStubCommand(binDir, "npm", "echo npm should not run >&2\nexit 99");

  const result = runProcessDropbox({ scriptPath, binDir, args: ["--no-dataform"] });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(result.stdout, "");
  assert.equal(existsSync(droppedFile), true);
});

test("process-dropbox allows dry-run inspection without a user id", () => {
  const { scriptPath, dropboxDir, binDir } = createIsolatedRepo();
  const droppedFile = join(dropboxDir, "chase-activity.csv");

  writeFileSync(droppedFile, "Transaction Date,Description,Amount\n", "utf8");
  writeStubCommand(binDir, "gcloud", "echo gcloud should not run >&2\nexit 99");
  writeStubCommand(binDir, "npm", "echo npm should not run >&2\nexit 99");

  const result = runProcessDropbox({ scriptPath, binDir, args: ["--dry-run"] });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /chase-activity\.csv\s+->\s+chase/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(existsSync(droppedFile), true);
});

test("process-dropbox loads .env.local and passes the resolved user id to ETL", () => {
  const { repoRoot, scriptPath, dropboxDir, binDir } = createIsolatedRepo();
  const callsLog = join(repoRoot, "calls.log");

  writeFileSync(join(dropboxDir, "discover-export.csv"), "Date,Description,Amount\n", "utf8");
  writeFileSync(
    join(repoRoot, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="user-from-env-file"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
    "utf8",
  );
  writeStubCommand(binDir, "gcloud", `printf 'gcloud:%s\\n' "$*" >> "${callsLog}"`);
  writeStubCommand(binDir, "npm", `printf 'npm:%s\\n' "$*" >> "${callsLog}"`);

  const result = runProcessDropbox({ scriptPath, binDir, args: ["--no-dataform"] });

  assert.equal(result.status, 0, result.stderr);
  const calls = readFileSync(callsLog, "utf8");

  assert.match(
    calls,
    /gcloud:storage cp .*discover-export\.csv gs:\/\/env-bucket\/incoming\/discover\//,
  );
  assert.match(
    calls,
    /npm:run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id user-from-env-file/,
  );
});

test("process-dropbox command line user id overrides .env.local", () => {
  const { repoRoot, scriptPath, dropboxDir, binDir } = createIsolatedRepo();
  const callsLog = join(repoRoot, "calls.log");

  writeFileSync(join(dropboxDir, "chase-activity.csv"), "Transaction Date,Description,Amount\n", "utf8");
  writeFileSync(
    join(repoRoot, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=user-from-env-file\n",
    "utf8",
  );
  writeStubCommand(binDir, "gcloud", `printf 'gcloud:%s\\n' "$*" >> "${callsLog}"`);
  writeStubCommand(binDir, "npm", `printf 'npm:%s\\n' "$*" >> "${callsLog}"`);

  const result = runProcessDropbox({
    scriptPath,
    binDir,
    args: ["--no-dataform", "--user-id", "user-from-cli"],
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(callsLog, "utf8"),
    /npm:run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 50 --user-id user-from-cli/,
  );
});
