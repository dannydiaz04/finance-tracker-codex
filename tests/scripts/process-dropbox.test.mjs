import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function createHarness() {
  const root = mkdtemp();
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const fakeBin = join(root, "bin");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  cpSync(sourceScript, scriptPath);
  chmodSync(scriptPath, 0o755);

  const callLog = join(root, "calls.log");
  writeFileSync(callLog, "", "utf8");

  for (const command of ["gcloud", "npm", "npx"]) {
    const commandPath = join(fakeBin, command);
    writeFileSync(
      commandPath,
      [
        "#!/usr/bin/env bash",
        `printf '%s %s\\n' '${command}' "$*" >> "$CALL_LOG"`,
      ].join("\n"),
      "utf8",
    );
    chmodSync(commandPath, 0o755);
  }

  return { root, dropboxDir, scriptPath, fakeBin, callLog };
}

function mkdtemp() {
  return mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
}

async function withHarness(fn) {
  const harness = createHarness();

  try {
    await fn(harness);
  } finally {
    rmSync(harness.root, { recursive: true, force: true });
  }
}

function writeCsv(dropboxDir, fileName = "chase-export.csv") {
  const filePath = join(dropboxDir, fileName);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n", "utf8");
  return filePath;
}

function runScript(harness, args = [], env = {}) {
  return spawnSync("bash", [harness.scriptPath, ...args], {
    cwd: harness.root,
    env: {
      ...process.env,
      PATH: `${harness.fakeBin}${delimiter}${process.env.PATH}`,
      CALL_LOG: harness.callLog,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
    encoding: "utf8",
  });
}

function readCalls(harness) {
  return readFileSync(harness.callLog, "utf8").trim();
}

test("refuses real ingest without a user id before upload or ETL side effects", async () => {
  await withHarness(async (harness) => {
    const filePath = writeCsv(harness.dropboxDir);

    const result = runScript(harness);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Refusing to ingest without a user id/);
    assert.match(result.stderr, /WAREHOUSE_IMPORT_USER_ID/);
    assert.equal(readCalls(harness), "");
    assert.equal(existsSync(filePath), true);
  });
});

test("allows dry run without credentials and does not call external tools", async () => {
  await withHarness(async (harness) => {
    const filePath = writeCsv(harness.dropboxDir, "discover-export.csv");

    const result = runScript(harness, ["--dry-run"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Dry run complete/);
    assert.match(result.stdout, /discover-export\.csv\s+->\s+discover/);
    assert.equal(readCalls(harness), "");
    assert.equal(existsSync(filePath), true);
  });
});

test("loads user and bucket defaults from .env.local and forwards the user id to ETL", async () => {
  await withHarness(async (harness) => {
    const filePath = writeCsv(harness.dropboxDir);
    writeFileSync(
      join(harness.root, ".env.local"),
      [
        "WAREHOUSE_IMPORT_USER_ID=user-from-env",
        "WAREHOUSE_LANDING_BUCKET=env-landing-bucket",
      ].join("\n"),
      "utf8",
    );

    const result = runScript(harness, ["--no-dataform"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(filePath), false);

    const calls = readCalls(harness);
    assert.match(
      calls,
      /gcloud storage cp .*chase-export\.csv gs:\/\/env-landing-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-export\.csv/,
    );
    assert.match(
      calls,
      /npm run etl:runner -- --gcs-bucket env-landing-bucket --max-files 50 --user-id user-from-env/,
    );
    assert.doesNotMatch(calls, /^npx /m);
  });
});
