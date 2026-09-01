import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import test from "node:test";

function createScriptRepo(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "dropbox"), { recursive: true });

  const scriptPath = join(root, "scripts", "process-dropbox.sh");
  copyFileSync(join(process.cwd(), "scripts", "process-dropbox.sh"), scriptPath);
  chmodSync(scriptPath, 0o755);

  return root;
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function installCommandStubs(root) {
  const binDirectory = join(root, "bin");
  const commandLog = join(root, "commands.log");
  mkdirSync(binDirectory, { recursive: true });

  const recorder = `#!/usr/bin/env bash
{
  printf '%s' "$(basename "$0")"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$TEST_COMMAND_LOG"
`;

  writeExecutable(join(binDirectory, "gcloud"), recorder);
  writeExecutable(join(binDirectory, "npm"), recorder);
  writeExecutable(join(binDirectory, "npx"), recorder);

  return { binDirectory, commandLog };
}

function runProcessDropbox(root, args = [], envOverrides = {}) {
  const { binDirectory, commandLog } = installCommandStubs(root);
  const result = spawnSync(join(root, "scripts", "process-dropbox.sh"), args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
      TEST_COMMAND_LOG: commandLog,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...envOverrides,
    },
  });

  return {
    ...result,
    commandLog: existsSync(commandLog) ? readFileSync(commandLog, "utf8") : "",
  };
}

test("real Dropbox ingest refuses to run without an import user id", (t) => {
  const root = createScriptRepo(t);
  const csvPath = join(root, "dropbox", "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");

  const result = runProcessDropbox(root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(result.commandLog, "");
  assert.equal(existsSync(csvPath), true);
});

test("dry-run Dropbox ingest does not require a user id or call external commands", (t) => {
  const root = createScriptRepo(t);
  const csvPath = join(root, "dropbox", "discover-export.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");

  const result = runProcessDropbox(root, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /discover-export\.csv\s+->\s+discover/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(result.commandLog, "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest reads env defaults and forwards the user id to the ETL runner", (t) => {
  const root = createScriptRepo(t);
  const csvPath = join(root, "dropbox", "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Payroll,100.00\n", "utf8");
  writeFileSync(sidecarPath, '{"accountName":"Checking"}\n', "utf8");
  writeFileSync(
    join(root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=\"user-from-env\"\nWAREHOUSE_LANDING_BUCKET='bucket-from-env'\n",
    "utf8",
  );

  const result = runProcessDropbox(root, ["--no-dataform"]);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Bucket: gs:\/\/bucket-from-env/);
  assert.match(result.stdout, /capital_one-checking\.csv\s+->\s+capital_one/);

  const commandLines = result.commandLog.trim().split("\n");
  assert.equal(commandLines.length, 3);
  assert.match(
    commandLines[0],
    /^gcloud\tstorage\tcp\t.*capital_one-checking\.csv\tgs:\/\/bucket-from-env\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv$/,
  );
  assert.match(
    commandLines[1],
    /^gcloud\tstorage\tcp\t.*capital_one-checking\.csv\.context\.json\tgs:\/\/bucket-from-env\/incoming\/capital_one\/\d{4}\/\d{2}\/\d{2}\/capital_one-checking\.csv\.context\.json$/,
  );
  assert.equal(
    commandLines[2],
    "npm\trun\tetl:runner\t--\t--gcs-bucket\tbucket-from-env\t--max-files\t50\t--user-id\tuser-from-env",
  );
  assert.equal(commandLines.some((line) => line.startsWith("npx\t")), false);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
});
