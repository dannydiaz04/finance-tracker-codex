import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function createScriptRepo(t) {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(repoRoot, "scripts");
  const dropboxDirectory = join(repoRoot, "dropbox");
  const binDirectory = join(repoRoot, "bin");
  const commandLog = join(repoRoot, "commands.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  cpSync(
    join(process.cwd(), "scripts/process-dropbox.sh"),
    join(scriptsDirectory, "process-dropbox.sh"),
  );
  chmodSync(join(scriptsDirectory, "process-dropbox.sh"), 0o755);

  writeExecutable(
    join(binDirectory, "gcloud"),
    [
      "#!/usr/bin/env bash",
      "printf 'gcloud:%s\\n' \"$*\" >> \"$COMMAND_LOG\"",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeExecutable(
    join(binDirectory, "npm"),
    [
      "#!/usr/bin/env bash",
      "printf 'npm:%s\\n' \"$*\" >> \"$COMMAND_LOG\"",
      "exit 0",
      "",
    ].join("\n"),
  );
  writeExecutable(
    join(binDirectory, "npx"),
    [
      "#!/usr/bin/env bash",
      "printf 'npx:%s\\n' \"$*\" >> \"$COMMAND_LOG\"",
      "exit 0",
      "",
    ].join("\n"),
  );

  t.after(() => rmSync(repoRoot, { recursive: true, force: true }));

  return {
    repoRoot,
    dropboxDirectory,
    binDirectory,
    commandLog,
  };
}

function runProcessDropbox(repo, args = [], env = {}) {
  return spawnSync("bash", ["scripts/process-dropbox.sh", ...args], {
    cwd: repo.repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      COMMAND_LOG: repo.commandLog,
      ETL_MAX_FILES: "",
      PATH: `${repo.binDirectory}:${process.env.PATH}`,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
  });
}

function writeDropboxCsv(repo, fileName = "chase-activity.csv") {
  const csvPath = join(repo.dropboxDirectory, fileName);
  writeFileSync(csvPath, "Date,Description,Amount\n2026-04-01,Coffee,-4.25\n", "utf8");
  return csvPath;
}

function findUploadedFile(repo, fileName) {
  const uploadedRoot = join(repo.dropboxDirectory, "_uploaded");

  if (!existsSync(uploadedRoot)) {
    return null;
  }

  const stack = [uploadedRoot];

  while (stack.length > 0) {
    const directory = stack.pop();

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        stack.push(entryPath);
      } else if (entry.name === fileName) {
        return entryPath;
      }
    }
  }

  return null;
}

test("process-dropbox refuses real ingest before side effects when no user id is configured", (t) => {
  const repo = createScriptRepo(t);
  const csvPath = writeDropboxCsv(repo);

  const result = runProcessDropbox(repo, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(existsSync(repo.commandLog), false);
  assert.equal(existsSync(csvPath), true);
  assert.equal(findUploadedFile(repo, "chase-activity.csv"), null);
});

test("process-dropbox dry run remains side-effect free without a user id", (t) => {
  const repo = createScriptRepo(t);
  const csvPath = writeDropboxCsv(repo);
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, "{}\n", "utf8");

  const result = runProcessDropbox(repo, ["--dry-run"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /\(\+ sidecar chase-activity\.csv\.context\.json\)/);
  assert.equal(existsSync(repo.commandLog), false);
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test("process-dropbox loads user and bucket defaults from .env.local for real ingest", (t) => {
  const repo = createScriptRepo(t);
  const csvPath = writeDropboxCsv(repo);
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(sidecarPath, "{}\n", "utf8");
  writeFileSync(
    join(repo.repoRoot, ".env.local"),
    [
      'WAREHOUSE_IMPORT_USER_ID="env-user"',
      "WAREHOUSE_LANDING_BUCKET='env-bucket'",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runProcessDropbox(repo, ["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bucket: gs:\/\/env-bucket/);
  assert.equal(existsSync(csvPath), false);
  assert.equal(existsSync(sidecarPath), false);
  assert.ok(findUploadedFile(repo, "chase-activity.csv"));
  assert.ok(findUploadedFile(repo, "chase-activity.csv.context.json"));

  const commands = readFileSync(repo.commandLog, "utf8");
  assert.match(
    commands,
    /gcloud:storage cp .*chase-activity\.csv gs:\/\/env-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv/,
  );
  assert.match(
    commands,
    /gcloud:storage cp .*chase-activity\.csv\.context\.json gs:\/\/env-bucket\/incoming\/chase\/\d{4}\/\d{2}\/\d{2}\/chase-activity\.csv\.context\.json/,
  );
  assert.match(
    commands,
    /npm:run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );
});

test("process-dropbox command-line user id overrides .env.local", (t) => {
  const repo = createScriptRepo(t);
  writeDropboxCsv(repo, "discover-export.csv");
  writeFileSync(
    join(repo.repoRoot, ".env.local"),
    [
      "WAREHOUSE_IMPORT_USER_ID=env-user",
      "WAREHOUSE_LANDING_BUCKET=env-bucket",
      "",
    ].join("\n"),
    "utf8",
  );

  const result = runProcessDropbox(repo, [
    "--no-dataform",
    "--user-id",
    "cli-user",
  ]);

  assert.equal(result.status, 0, result.stderr);

  const commands = readFileSync(repo.commandLog, "utf8");
  assert.match(
    commands,
    /npm:run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user/,
  );
  assert.doesNotMatch(commands, /--user-id env-user/);
});
