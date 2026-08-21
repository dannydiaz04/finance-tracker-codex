import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import test from "node:test";

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function createIsolatedRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(repoRoot, "scripts");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(join(repoRoot, "dropbox"), { recursive: true });

  const scriptPath = join(scriptsDirectory, "process-dropbox.sh");
  copyFileSync(sourceScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  return {
    repoRoot,
    scriptPath,
  };
}

function writeCommandStub(binDirectory, commandName) {
  const commandPath = join(binDirectory, commandName);

  writeFileSync(
    commandPath,
    `#!/usr/bin/env bash
{
  printf '%s' "\${0##*/}"
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$STUB_LOG"
exit 0
`,
    "utf8",
  );
  chmodSync(commandPath, 0o755);
}

function installCommandStubs(repoRoot) {
  const binDirectory = join(repoRoot, "bin");
  const logPath = join(repoRoot, "stub-commands.log");

  mkdirSync(binDirectory, { recursive: true });
  writeCommandStub(binDirectory, "gcloud");
  writeCommandStub(binDirectory, "npm");

  return {
    binDirectory,
    logPath,
  };
}

function runProcessDropbox(repo, args = [], env = {}) {
  return spawnSync("bash", [repo.scriptPath, ...args], {
    cwd: repo.repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
  });
}

test("Dropbox ingest refuses a real run without a user id", () => {
  const repo = createIsolatedRepo();

  try {
    const result = runProcessDropbox(repo);

    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
    );
    assert.match(
      result.stderr,
      /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id\./,
    );
  } finally {
    rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test("Dropbox dry runs can preview files without a user id", () => {
  const repo = createIsolatedRepo();

  try {
    writeFileSync(
      join(repo.repoRoot, "dropbox", "chase-activity.csv"),
      "Transaction Date,Description,Amount\n2026-04-13,Coffee,-4.25\n",
      "utf8",
    );

    const result = runProcessDropbox(repo, ["--dry-run"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /chase-activity\.csv\s+->\s+chase/);
    assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  } finally {
    rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

test("Dropbox ingest loads .env.local and forwards the user id to the ETL runner", () => {
  const repo = createIsolatedRepo();
  const stubs = installCommandStubs(repo.repoRoot);

  try {
    writeFileSync(
      join(repo.repoRoot, ".env.local"),
      'WAREHOUSE_IMPORT_USER_ID="user-from-env"\nWAREHOUSE_LANDING_BUCKET=\'bucket-from-env\'\n',
      "utf8",
    );
    writeFileSync(
      join(repo.repoRoot, "dropbox", "chase-activity.csv"),
      "Transaction Date,Description,Amount\n2026-04-13,Coffee,-4.25\n",
      "utf8",
    );

    const result = runProcessDropbox(repo, ["--no-dataform"], {
      PATH: `${stubs.binDirectory}${delimiter}${process.env.PATH ?? ""}`,
      STUB_LOG: stubs.logPath,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bucket: gs:\/\/bucket-from-env/);

    const commandLog = readFileSync(stubs.logPath, "utf8");

    assert.match(
      commandLog,
      /gcloud\tstorage\tcp\t.*dropbox\/chase-activity\.csv\tgs:\/\/bucket-from-env\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
    );
    assert.match(
      commandLog,
      /npm\trun\tetl:runner\t--\t--gcs-bucket\tbucket-from-env\t--max-files\t50\t--user-id\tuser-from-env/,
    );
  } finally {
    rmSync(repo.repoRoot, { recursive: true, force: true });
  }
});

