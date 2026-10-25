import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

async function createSandbox() {
  const root = await mkdtemp(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  writeExecutable(
    binDirectory,
    "date",
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 10 ;;
  +%d) echo 25 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  return {
    root,
    scriptPath,
    dropboxDirectory,
    binDirectory,
    commandLogPath: join(root, "commands.log"),
  };
}

function writeExecutable(directory, name, contents) {
  const filePath = join(directory, name);
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
  return filePath;
}

function installCommandLogger(sandbox, commandName) {
  writeExecutable(
    sandbox.binDirectory,
    commandName,
    `#!/usr/bin/env bash
printf '%s' '${commandName}' >> "${sandbox.commandLogPath}"
printf ' %q' "$@" >> "${sandbox.commandLogPath}"
printf '\\n' >> "${sandbox.commandLogPath}"
`,
  );
}

function runProcessDropbox(sandbox, args = [], env = {}) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env: {
      ...process.env,
      ...env,
      PATH: `${sandbox.binDirectory}:${process.env.PATH}`,
      WAREHOUSE_IMPORT_USER_ID: env.WAREHOUSE_IMPORT_USER_ID ?? "",
      WAREHOUSE_LANDING_BUCKET: env.WAREHOUSE_LANDING_BUCKET ?? "",
    },
    encoding: "utf8",
  });
}

function readCommandLog(sandbox) {
  return existsSync(sandbox.commandLogPath)
    ? readFileSync(sandbox.commandLogPath, "utf8")
    : "";
}

test("Dropbox ingest refuses a non-dry-run import without a user id before side effects", async () => {
  const sandbox = await createSandbox();
  writeFileSync(join(sandbox.dropboxDirectory, "chase-activity.csv"), "Date,Amount\n2026-10-25,12.34\n");
  installCommandLogger(sandbox, "gcloud");
  installCommandLogger(sandbox, "npm");

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.equal(readCommandLog(sandbox), "");
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest dry-run can preview files without a user id or uploads", async () => {
  const sandbox = await createSandbox();
  writeFileSync(join(sandbox.dropboxDirectory, "Discover-activity.csv"), "Date,Amount\n2026-10-25,12.34\n");
  writeFileSync(join(sandbox.dropboxDirectory, "Discover-activity.csv.context.json"), '{"userId":"context-user"}\n');
  installCommandLogger(sandbox, "gcloud");
  installCommandLogger(sandbox, "npm");

  const result = runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Discover-activity\.csv\s+->\s+discover/);
  assert.match(result.stdout, /\(\+ sidecar Discover-activity\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(readCommandLog(sandbox), "");
  assert.equal(existsSync(join(sandbox.dropboxDirectory, "_uploaded")), false);
});

test("Dropbox ingest loads env defaults, uploads sidecars, archives files, and forwards user id", async () => {
  const sandbox = await createSandbox();
  writeFileSync(join(sandbox.root, ".env.local"), [
    "WAREHOUSE_IMPORT_USER_ID=env-user",
    "WAREHOUSE_LANDING_BUCKET=env-bucket",
    "",
  ].join("\n"));
  writeFileSync(join(sandbox.dropboxDirectory, "chase-activity.csv"), "Date,Amount\n2026-10-25,12.34\n");
  writeFileSync(join(sandbox.dropboxDirectory, "chase-activity.csv.context.json"), '{"sourceAccountId":"card-1"}\n');
  installCommandLogger(sandbox, "gcloud");
  installCommandLogger(sandbox, "npm");

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner against the bucket/);

  const commandLog = readCommandLog(sandbox);
  assert.match(
    commandLog,
    /gcloud storage cp .*chase-activity\.csv gs:\/\/env-bucket\/incoming\/chase\/2026\/10\/25\/chase-activity\.csv/,
  );
  assert.match(
    commandLog,
    /gcloud storage cp .*chase-activity\.csv\.context\.json gs:\/\/env-bucket\/incoming\/chase\/2026\/10\/25\/chase-activity\.csv\.context\.json/,
  );
  assert.match(
    commandLog,
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-10-25/chase-activity.csv")),
    true,
  );
  assert.equal(
    existsSync(join(sandbox.dropboxDirectory, "_uploaded/2026-10-25/chase-activity.csv.context.json")),
    true,
  );
});
