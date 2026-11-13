import assert from "node:assert/strict";
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
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = process.cwd();

function createSandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const fakeBinDir = join(root, "bin");
  const captureFile = join(root, "commands.log");
  const scriptPath = join(scriptsDir, "process-dropbox.sh");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  copyFileSync(
    join(repositoryRoot, "scripts", "process-dropbox.sh"),
    scriptPath,
  );
  chmodSync(scriptPath, 0o755);

  for (const command of ["gcloud", "npm", "npx"]) {
    const fakeCommandPath = join(fakeBinDir, command);
    writeFileSync(
      fakeCommandPath,
      [
        "#!/usr/bin/env bash",
        `{ printf '${command}'; for arg in "$@"; do printf '\\t%s' "$arg"; done; printf '\\n'; } >> "$PROCESS_DROPBOX_CAPTURE"`,
        "",
      ].join("\n"),
      "utf8",
    );
    chmodSync(fakeCommandPath, 0o755);
  }

  t.after(() => rmSync(root, { recursive: true, force: true }));

  return { root, dropboxDir, fakeBinDir, captureFile, scriptPath };
}

function runProcessDropbox(sandbox, args = [], extraEnv = {}) {
  const env = {
    ...process.env,
    PATH: `${sandbox.fakeBinDir}:${process.env.PATH ?? ""}`,
    PROCESS_DROPBOX_CAPTURE: sandbox.captureFile,
    ...extraEnv,
  };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.WAREHOUSE_LANDING_ROOT;
  delete env.WAREHOUSE_LANDING_URI;
  delete env.ETL_MAX_FILES;

  for (const [key, value] of Object.entries(extraEnv)) {
    if (typeof value === "undefined") {
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

function readCapturedCommands(sandbox) {
  return existsSync(sandbox.captureFile)
    ? readFileSync(sandbox.captureFile, "utf8")
    : "";
}

test("Dropbox ingest refuses non-dry-run work without a user id before side effects", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = join(sandbox.dropboxDir, "chase-activity.csv");
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");

  const result = runProcessDropbox(sandbox);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID/);
  assert.equal(readCapturedCommands(sandbox), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry-run previews files without requiring a user id", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = join(sandbox.dropboxDir, "Apple_Card-April.CSV");
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Apple Card"}\n');

  const result = runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Apple_Card-April\.CSV\s+->\s+apple_card/);
  assert.match(result.stdout, /\(\+ sidecar Apple_Card-April\.CSV\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(readCapturedCommands(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("Dropbox ingest loads env-local user and bucket defaults for upload and ETL", (t) => {
  const sandbox = createSandbox(t);
  const csvPath = join(sandbox.dropboxDir, "discover-export.csv");
  writeFileSync(csvPath, "Trans. Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n');
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID='env-user'\nWAREHOUSE_LANDING_BUCKET=\"landing-bucket\"\n",
  );

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 0);
  const commands = readCapturedCommands(sandbox).trim().split("\n");
  assert.equal(commands.length, 3);
  assert.match(
    commands[0],
    /^gcloud\tstorage\tcp\t.*discover-export\.csv\tgs:\/\/landing-bucket\/incoming\/discover\//,
  );
  assert.match(
    commands[1],
    /^gcloud\tstorage\tcp\t.*discover-export\.csv\.context\.json\tgs:\/\/landing-bucket\/incoming\/discover\/.*discover-export\.csv\.context\.json$/,
  );
  assert.equal(
    commands[2],
    "npm\trun\tetl:runner\t--\t--gcs-bucket\tlanding-bucket\t--max-files\t50\t--user-id\tenv-user",
  );
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(`${csvPath}.context.json`), false);
});

test("Dropbox ingest CLI user id overrides env-local defaults", (t) => {
  const sandbox = createSandbox(t);
  writeFileSync(
    join(sandbox.dropboxDir, "manual-upload.csv"),
    "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n",
  );
  writeFileSync(
    join(sandbox.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=landing-bucket\n",
  );

  const result = runProcessDropbox(sandbox, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0);
  const commands = readCapturedCommands(sandbox).trim().split("\n");
  assert.equal(commands.at(-1), "npm\trun\tetl:runner\t--\t--gcs-bucket\tlanding-bucket\t--max-files\t50\t--user-id\tcli-user");
});
