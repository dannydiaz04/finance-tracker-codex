import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function createHarness() {
  const root = mkHarnessRoot();
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "dropbox"), { recursive: true });
  copyFileSync(sourceScript, join(root, "scripts/process-dropbox.sh"));
  return root;
}

function mkHarnessRoot() {
  return mkdtempSync(join(tmpdir(), "finance-dropbox-"));
}

function runDropbox(root, args = [], env = {}) {
  return spawnSync("bash", [join(root, "scripts/process-dropbox.sh"), ...args], {
    cwd: root,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf8",
  });
}

function writeStub(root, command, body) {
  const binDir = join(root, "bin");
  mkdirSync(binDir, { recursive: true });
  const target = join(binDir, command);
  writeFileSync(target, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
  chmodSync(target, 0o755);
}

test("process-dropbox refuses real ingest without an owning user id", () => {
  const root = createHarness();

  const result = runDropbox(root);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
});

test("process-dropbox dry run does not require user id and reports sidecar context", () => {
  const root = createHarness();
  const csvPath = join(root, "dropbox/capital_one-checking.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n");
  writeFileSync(`${csvPath}.context.json`, '{"sourceAccountId":"capital_one_checking"}\n');

  const result = runDropbox(root, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /capital_one-checking\.csv\s+->\s+capital_one/);
  assert.match(result.stdout, /\(\+ sidecar capital_one-checking\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
});

test("process-dropbox loads env defaults and forwards user id to the ETL runner", () => {
  const root = createHarness();
  const commandLog = join(root, "commands.log");
  writeFileSync(
    join(root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="user-from-env"\nWAREHOUSE_LANDING_BUCKET="bucket-from-env"\n',
  );
  writeFileSync(join(root, "dropbox/chase-activity.csv"), "date,description,amount\n");
  writeStub(root, "gcloud", `printf 'gcloud %q\\n' "$*" >> "${commandLog}"`);
  writeStub(root, "npm", `printf 'npm %q\\n' "$*" >> "${commandLog}"`);

  const dateBeforeRun = uploadedDate();
  const result = runDropbox(root, ["--no-dataform"], {
    ETL_MAX_FILES: "7",
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
  });
  const dateAfterRun = uploadedDate();

  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(commandLog, "utf8");
  assert.match(
    commands,
    /gcloud storage\\ cp\\ .+ gs:\/\/bucket-from-env\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
  );
  assert.match(
    commands,
    /npm run\\ etl:runner\\ --\\ --gcs-bucket\\ bucket-from-env\\ --max-files\\ 7\\ --user-id\\ user-from-env/,
  );
  assert.ok(
    [dateBeforeRun, dateAfterRun].some((date) =>
      existsSync(join(root, "dropbox/_uploaded", date, "chase-activity.csv")),
    ),
  );
});

test("process-dropbox lets --user-id override env defaults", () => {
  const root = createHarness();
  const commandLog = join(root, "commands.log");
  writeFileSync(
    join(root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="user-from-env"\nWAREHOUSE_LANDING_BUCKET="bucket-from-env"\n',
  );
  writeFileSync(join(root, "dropbox/manual.csv"), "date,description,amount\n");
  writeStub(root, "gcloud", `printf 'gcloud %q\\n' "$*" >> "${commandLog}"`);
  writeStub(root, "npm", `printf 'npm %q\\n' "$*" >> "${commandLog}"`);

  const result = runDropbox(root, ["--no-dataform", "--user-id", "user-from-cli"], {
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
  });

  assert.equal(result.status, 0, result.stderr);
  const commands = readFileSync(commandLog, "utf8");
  assert.match(
    commands,
    /npm run\\ etl:runner\\ --\\ --gcs-bucket\\ bucket-from-env\\ --max-files\\ 50\\ --user-id\\ user-from-cli/,
  );
  assert.doesNotMatch(commands, /user-from-env/);
});

function uploadedDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
