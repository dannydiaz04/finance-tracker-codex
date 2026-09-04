import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const realScriptPath = join(repoRoot, "scripts", "process-dropbox.sh");

function createSandbox({ envLocal } = {}) {
  const root = mkdtempSync(join(tmpdir(), "finance-process-dropbox-"));
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  const invocationsPath = join(root, "invocations.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  copyFileSync(realScriptPath, scriptPath);
  chmodSync(scriptPath, 0o755);

  if (envLocal) {
    writeFileSync(join(root, ".env.local"), envLocal, "utf8");
  }

  writeFakeCommand(binDir, "gcloud");
  writeFakeCommand(binDir, "npm");
  writeFakeCommand(binDir, "npx");

  return {
    root,
    dropboxDir,
    binDir,
    invocationsPath,
    scriptPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function writeFakeCommand(binDir, commandName) {
  const commandPath = join(binDir, commandName);

  writeFileSync(
    commandPath,
    `#!/usr/bin/env bash
printf '${commandName} %s\\n' "$*" >> "$PROCESS_DROPBOX_INVOCATIONS"
`,
    "utf8",
  );
  chmodSync(commandPath, 0o755);
}

function writeCsv(sandbox, fileName = "chase-activity.csv") {
  const csvPath = join(sandbox.dropboxDir, fileName);

  writeFileSync(
    csvPath,
    "Date,Description,Amount\n2026-04-13,Test transaction,12.34\n",
    "utf8",
  );

  return csvPath;
}

function runProcessDropbox(sandbox, args = [], envOverrides = {}) {
  const env = { ...process.env };

  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  Object.assign(env, envOverrides, {
    PATH: `${sandbox.binDir}:${process.env.PATH ?? ""}`,
    PROCESS_DROPBOX_INVOCATIONS: sandbox.invocationsPath,
  });

  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    env,
    encoding: "utf8",
  });
}

function readInvocations(sandbox) {
  return existsSync(sandbox.invocationsPath)
    ? readFileSync(sandbox.invocationsPath, "utf8")
    : "";
}

function listFiles(directory, prefix = "") {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    const absolutePath = join(directory, entry.name);

    return entry.isDirectory()
      ? listFiles(absolutePath, relativePath)
      : [relativePath];
  });
}

test("real ingest refuses to run without a user id before upload side effects", () => {
  const sandbox = createSandbox();

  try {
    const csvPath = writeCsv(sandbox);
    const result = runProcessDropbox(sandbox, ["--no-dataform"]);

    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /Refusing to ingest without a user id/);
    assert.equal(readInvocations(sandbox), "");
    assert.equal(existsSync(csvPath), true);
    assert.equal(existsSync(join(sandbox.dropboxDir, "_uploaded")), false);
  } finally {
    sandbox.cleanup();
  }
});

test("dry run can inspect files without a user id or side effects", () => {
  const sandbox = createSandbox();

  try {
    const csvPath = writeCsv(sandbox);
    const result = runProcessDropbox(sandbox, ["--dry-run"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
    assert.equal(readInvocations(sandbox), "");
    assert.equal(existsSync(csvPath), true);
    assert.equal(existsSync(join(sandbox.dropboxDir, "_uploaded")), false);
  } finally {
    sandbox.cleanup();
  }
});

test(".env.local supplies the ingest user id and landing bucket", () => {
  const sandbox = createSandbox({
    envLocal:
      "WAREHOUSE_IMPORT_USER_ID='env-user-123'\nWAREHOUSE_LANDING_BUCKET=\"env-bucket-456\"\n",
  });

  try {
    const csvPath = writeCsv(sandbox);
    const result = runProcessDropbox(sandbox, ["--no-dataform"]);

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const invocations = readInvocations(sandbox);

    assert.match(
      invocations,
      /gcloud storage cp .*chase-activity\.csv gs:\/\/env-bucket-456\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
    );
    assert.match(
      invocations,
      /npm run etl:runner -- --gcs-bucket env-bucket-456 --max-files 50 --user-id env-user-123/,
    );
    assert.equal(existsSync(csvPath), false);
    assert.equal(
      listFiles(join(sandbox.dropboxDir, "_uploaded")).some((filePath) =>
        filePath.endsWith("chase-activity.csv"),
      ),
      true,
    );
  } finally {
    sandbox.cleanup();
  }
});

test("CLI user id overrides .env.local before invoking the ETL runner", () => {
  const sandbox = createSandbox({
    envLocal:
      "WAREHOUSE_IMPORT_USER_ID=env-user-123\nWAREHOUSE_LANDING_BUCKET=env-bucket-456\n",
  });

  try {
    writeCsv(sandbox);
    const result = runProcessDropbox(sandbox, [
      "--no-dataform",
      "--user-id",
      "cli-user-789",
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);

    const invocations = readInvocations(sandbox);

    assert.match(
      invocations,
      /npm run etl:runner -- --gcs-bucket env-bucket-456 --max-files 50 --user-id cli-user-789/,
    );
    assert.doesNotMatch(invocations, /--user-id env-user-123/);
  } finally {
    sandbox.cleanup();
  }
});
