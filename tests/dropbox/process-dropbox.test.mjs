import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function createScriptWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");

  mkdirSync(scriptsDirectory, { recursive: true });
  writeFileSync(
    join(scriptsDirectory, "process-dropbox.sh"),
    readFileSync(sourceScriptPath, "utf8"),
    "utf8",
  );

  return root;
}

function runProcessDropBox(root, args = [], env = {}) {
  return spawnSync("bash", [join(root, "scripts/process-dropbox.sh"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      HOME: root,
      PATH: process.env.PATH ?? "",
      ...env,
    },
  });
}

function writeDropboxFile(root, relativePath, contents = "Date,Description,Amount\n2026-04-01,Coffee,-4.50\n") {
  const filePath = join(root, "dropbox", relativePath);

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");

  return filePath;
}

test("process-dropbox refuses real ingest when no user id is available", () => {
  const root = createScriptWorkspace();

  writeDropboxFile(root, "discover-export.csv");

  const result = runProcessDropBox(root, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /WAREHOUSE_IMPORT_USER_ID/);
});

test("process-dropbox dry run does not require a user id", () => {
  const root = createScriptWorkspace();

  writeDropboxFile(root, "capital_one-checking.csv");

  const result = runProcessDropBox(root, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /capital_one-checking\.csv\s+->\s+capital_one/);
  assert.match(result.stdout, /Dry run complete/);
});

test("process-dropbox reads env-local defaults and passes the user id to the ETL runner", () => {
  const root = createScriptWorkspace();
  const binDirectory = join(root, "bin");
  const gcloudLogPath = join(root, "gcloud.log");
  const npmLogPath = join(root, "npm.log");

  mkdirSync(binDirectory, { recursive: true });
  writeFileSync(
    join(root, ".env.local"),
    [
      "WAREHOUSE_IMPORT_USER_ID='user-from-env'",
      'WAREHOUSE_LANDING_BUCKET="bucket-from-env"',
      "",
    ].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${gcloudLogPath}"\n`,
    "utf8",
  );
  writeFileSync(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${npmLogPath}"\n`,
    "utf8",
  );
  chmodSync(join(binDirectory, "gcloud"), 0o755);
  chmodSync(join(binDirectory, "npm"), 0o755);

  writeDropboxFile(root, "chase-activity.csv");

  const result = runProcessDropBox(root, ["--no-dataform"], {
    PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    readFileSync(gcloudLogPath, "utf8"),
    /storage cp .*chase-activity\.csv gs:\/\/bucket-from-env\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
  );
  assert.equal(
    readFileSync(npmLogPath, "utf8").trim(),
    "run etl:runner -- --gcs-bucket bucket-from-env --max-files 50 --user-id user-from-env",
  );
  assert.equal(existsSync(join(root, "dropbox/chase-activity.csv")), false);
});
