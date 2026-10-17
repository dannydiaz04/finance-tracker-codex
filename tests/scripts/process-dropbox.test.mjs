import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const SOURCE_SCRIPT = new URL("../../scripts/process-dropbox.sh", import.meta.url);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeExecutable(filePath, contents) {
  await writeFile(filePath, contents, { mode: 0o755 });
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "process-dropbox-"));
  const scriptsDir = path.join(root, "scripts");
  const dropboxDir = path.join(root, "dropbox");
  const fakeBinDir = path.join(root, "fake-bin");
  const commandLog = path.join(root, "commands.log");

  await mkdir(scriptsDir);
  await mkdir(dropboxDir);
  await mkdir(fakeBinDir);

  await writeFile(
    path.join(scriptsDir, "process-dropbox.sh"),
    await readFile(SOURCE_SCRIPT, "utf8"),
    { mode: 0o755 },
  );

  await writeExecutable(
    path.join(fakeBinDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) printf '2026\\n' ;;
  +%m) printf '10\\n' ;;
  +%d) printf '17\\n' ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  const commandRecorder = `#!/usr/bin/env bash
printf '%s' "$(basename "$0")" >> "$FAKE_COMMAND_LOG"
for arg in "$@"; do
  printf '\\t%s' "$arg" >> "$FAKE_COMMAND_LOG"
done
printf '\\n' >> "$FAKE_COMMAND_LOG"
`;
  await writeExecutable(path.join(fakeBinDir, "gcloud"), commandRecorder);
  await writeExecutable(path.join(fakeBinDir, "npm"), commandRecorder);
  await writeExecutable(path.join(fakeBinDir, "npx"), commandRecorder);

  return {
    root,
    dropboxDir,
    fakeBinDir,
    commandLog,
    scriptPath: path.join(scriptsDir, "process-dropbox.sh"),
  };
}

function runScript(fixture, args = [], env = {}) {
  return new Promise((resolve) => {
    const child = spawn("bash", [fixture.scriptPath, ...args], {
      cwd: fixture.root,
      env: {
        ...process.env,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH}`,
        FAKE_COMMAND_LOG: fixture.commandLog,
        WAREHOUSE_IMPORT_USER_ID: "",
        WAREHOUSE_LANDING_BUCKET: "",
        ...env,
      },
      encoding: "utf8",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function readCommandLog(fixture) {
  if (!(await exists(fixture.commandLog))) {
    return "";
  }
  return readFile(fixture.commandLog, "utf8");
}

test("refuses real ingest without a user id before upload or ETL side effects", async () => {
  const fixture = await createFixture();
  const csvPath = path.join(fixture.dropboxDir, "chase-activity.csv");
  await writeFile(csvPath, "Date,Description,Amount\n2026-10-17,Coffee,-4.50\n");

  const result = await runScript(fixture);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(await readCommandLog(fixture), "");
  assert.equal(await exists(csvPath), true, "the source CSV should remain in the dropbox");
});

test("dry run stays safe without credentials or a user id", async () => {
  const fixture = await createFixture();
  const csvPath = path.join(fixture.dropboxDir, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  await writeFile(csvPath, "Posted Date,Description,Debit,Credit\n2026-10-17,Deposit,,100\n");
  await writeFile(sidecarPath, '{"account":"checking"}\n');

  const result = await runScript(fixture, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /capital_one-checking\.csv\s+->\s+capital_one/);
  assert.match(result.stdout, /\(\+ sidecar capital_one-checking\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(await readCommandLog(fixture), "");
  assert.equal(await exists(csvPath), true);
  assert.equal(await exists(sidecarPath), true);
});

test(".env.local supplies the import user and landing bucket for upload and ETL", async () => {
  const fixture = await createFixture();
  const csvPath = path.join(fixture.dropboxDir, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  await writeFile(path.join(fixture.root, ".env.local"), [
    'WAREHOUSE_IMPORT_USER_ID="user-from-env"',
    "WAREHOUSE_LANDING_BUCKET='landing-bucket'",
    "",
  ].join("\n"));
  await writeFile(csvPath, "Trans. Date,Description,Amount\n10/17/2026,Groceries,42.00\n");
  await writeFile(sidecarPath, '{"source":"discover"}\n');

  const result = await runScript(fixture, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)\. Running ETL runner/);
  assert.match(result.stdout, /Done\./);

  const log = await readCommandLog(fixture);
  assert.match(
    log,
    new RegExp(`gcloud\\tstorage\\tcp\\t${csvPath}\\tgs://landing-bucket/incoming/discover/2026/10/17/discover-export\\.csv`),
  );
  assert.match(
    log,
    new RegExp(`gcloud\\tstorage\\tcp\\t${sidecarPath}\\tgs://landing-bucket/incoming/discover/2026/10/17/discover-export\\.csv\\.context\\.json`),
  );
  assert.match(
    log,
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tlanding-bucket\t--max-files\t50\t--user-id\tuser-from-env/,
  );

  assert.equal(await exists(csvPath), false);
  assert.equal(await exists(sidecarPath), false);
  assert.equal(await exists(path.join(fixture.dropboxDir, "_uploaded/2026-10-17/discover-export.csv")), true);
  assert.equal(await exists(path.join(fixture.dropboxDir, "_uploaded/2026-10-17/discover-export.csv.context.json")), true);
});

test("--user-id overrides configured defaults when invoking the ETL runner", async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.root, ".env.local"), [
    "WAREHOUSE_IMPORT_USER_ID=user-from-env",
    "WAREHOUSE_LANDING_BUCKET=landing-bucket",
    "",
  ].join("\n"));
  await writeFile(
    path.join(fixture.dropboxDir, "manual-upload.csv"),
    "date,description,amount\n2026-10-17,Adjustment,12.34\n",
  );

  const result = await runScript(fixture, ["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    await readCommandLog(fixture),
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tlanding-bucket\t--max-files\t50\t--user-id\tcli-user/,
  );
});
