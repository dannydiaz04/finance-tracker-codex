import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceScript = path.resolve(__dirname, "../../scripts/process-dropbox.sh");

async function exists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeExecutable(filePath, contents) {
  await writeFile(filePath, contents, { mode: 0o755 });
}

async function createSandbox() {
  const root = await mkdtemp(path.join(tmpdir(), "process-dropbox-"));
  const scriptsDir = path.join(root, "scripts");
  const dropboxDir = path.join(root, "dropbox");
  const fakeBinDir = path.join(root, "fake-bin");
  const commandLog = path.join(root, "commands.log");

  await mkdir(scriptsDir, { recursive: true });
  await mkdir(dropboxDir, { recursive: true });
  await mkdir(fakeBinDir, { recursive: true });
  await copyFile(sourceScript, path.join(scriptsDir, "process-dropbox.sh"));

  await writeExecutable(
    path.join(fakeBinDir, "gcloud"),
    '#!/usr/bin/env bash\nprintf "gcloud %s\\n" "$*" >> "$FAKE_COMMAND_LOG"\n',
  );
  await writeExecutable(
    path.join(fakeBinDir, "npm"),
    '#!/usr/bin/env bash\nprintf "npm %s\\n" "$*" >> "$FAKE_COMMAND_LOG"\n',
  );
  await writeExecutable(
    path.join(fakeBinDir, "npx"),
    '#!/usr/bin/env bash\nprintf "npx %s\\n" "$*" >> "$FAKE_COMMAND_LOG"\n',
  );

  return {
    root,
    dropboxDir,
    commandLog,
    script: path.join(scriptsDir, "process-dropbox.sh"),
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      FAKE_COMMAND_LOG: commandLog,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
    },
  };
}

function runProcessDropbox(sandbox, args = []) {
  return spawnSync("bash", [sandbox.script, ...args], {
    cwd: sandbox.root,
    env: sandbox.env,
    encoding: "utf8",
  });
}

async function readCommandLog(sandbox) {
  return (await exists(sandbox.commandLog))
    ? readFile(sandbox.commandLog, "utf8")
    : "";
}

test("real ingest refuses to run without a configured import user id", async () => {
  const sandbox = await createSandbox();
  const csvPath = path.join(sandbox.dropboxDir, "chase-export.csv");
  await writeFile(csvPath, "Date,Description,Amount\n2026-09-01,Coffee,-5.00\n");

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(await readCommandLog(sandbox), "");
  assert.equal(await exists(csvPath), true);
});

test("dry run remains safe without a user id and leaves files in place", async () => {
  const sandbox = await createSandbox();
  const csvPath = path.join(sandbox.dropboxDir, "discover-export.csv");
  await writeFile(csvPath, "Trans. Date,Description,Amount\n2026-09-01,Store,-12.00\n");

  const result = runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(await readCommandLog(sandbox), "");
  assert.equal(await exists(csvPath), true);
});

test("loads import user and landing bucket from .env.local before upload", async () => {
  const sandbox = await createSandbox();
  await writeFile(
    path.join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="user-from-env"\nWAREHOUSE_LANDING_BUCKET=\'bucket-from-env\'\n',
  );
  const csvPath = path.join(sandbox.dropboxDir, "capital_one-checking.csv");
  await writeFile(csvPath, "Transaction Date,Description,Debit,Credit\n2026-09-01,Pay,1.00,\n");

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);
  const commandLog = await readCommandLog(sandbox);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bucket: gs:\/\/bucket-from-env/);
  assert.match(commandLog, /gcloud storage cp .*capital_one-checking\.csv gs:\/\/bucket-from-env\/incoming\/capital_one\//);
  assert.match(commandLog, /npm run etl:runner -- --gcs-bucket bucket-from-env --max-files 50 --user-id user-from-env/);
  assert.equal(await exists(csvPath), false);
});

test("command-line user id overrides .env.local when invoking the ETL runner", async () => {
  const sandbox = await createSandbox();
  await writeFile(
    path.join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=user-from-env\n",
  );
  await writeFile(
    path.join(sandbox.dropboxDir, "american_express-activity.csv"),
    "Date,Description,Amount\n2026-09-01,Hotel,-100.00\n",
  );

  const result = runProcessDropbox(sandbox, ["--no-dataform", "--user-id", "user-from-cli"]);
  const commandLog = await readCommandLog(sandbox);

  assert.equal(result.status, 0, result.stderr);
  assert.match(commandLog, /--user-id user-from-cli/);
  assert.doesNotMatch(commandLog, /--user-id user-from-env/);
});
