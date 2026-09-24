import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const dropboxDir = join(repoRoot, "dropbox");
const testPrefix = `automation-test-${process.pid}`;

function cleanDropboxArtifacts() {
  const removeMatching = (directory) => {
    if (!existsSync(directory)) {
      return;
    }

    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        removeMatching(path);
        if (entry !== "_uploaded" && readdirSync(path).length === 0) {
          rmSync(path, { recursive: true, force: true });
        }
        continue;
      }

      if (entry.includes(testPrefix)) {
        rmSync(path, { force: true });
      }
    }
  };

  removeMatching(dropboxDir);
}

function writeDropboxFile(name, contents = "Date,Description,Amount\n2026-09-24,Test,1.23\n") {
  const filePath = join(dropboxDir, name);
  mkdirSync(dropboxDir, { recursive: true });
  writeFileSync(filePath, contents);
  return filePath;
}

function findDropboxArtifact(fileName) {
  const matches = [];
  const visit = (directory) => {
    if (!existsSync(directory)) {
      return;
    }

    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) {
        visit(path);
      } else if (entry === fileName) {
        matches.push(path);
      }
    }
  };

  visit(dropboxDir);
  return matches;
}

function makeStubCommands() {
  const directory = mkdtempSync(join(tmpdir(), "dropbox-command-stubs-"));
  const logPath = join(directory, "commands.log");
  const stub = `#!/usr/bin/env bash
printf '%s %s\\n' "$(basename "$0")" "$*" >> "$STUB_COMMAND_LOG"
`;

  for (const command of ["gcloud", "npm", "npx"]) {
    const commandPath = join(directory, command);
    writeFileSync(commandPath, stub, { mode: 0o755 });
  }

  return { directory, logPath };
}

function runProcessDropbox(args, envOverrides = {}) {
  const stubs = makeStubCommands();
  const env = {
    ...process.env,
    PATH: `${stubs.directory}:${process.env.PATH}`,
    STUB_COMMAND_LOG: stubs.logPath,
    ...envOverrides,
  };
  delete env.WAREHOUSE_IMPORT_USER_ID;
  delete env.WAREHOUSE_LANDING_BUCKET;
  delete env.ETL_MAX_FILES;

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  const result = spawnSync("bash", ["scripts/process-dropbox.sh", ...args], {
    cwd: repoRoot,
    env,
    encoding: "utf8",
  });

  const commandLog = existsSync(stubs.logPath)
    ? readFileSync(stubs.logPath, "utf8")
    : "";
  rmSync(stubs.directory, { recursive: true, force: true });

  return { ...result, commandLog };
}

test.beforeEach(() => {
  cleanDropboxArtifacts();
});

test.afterEach(() => {
  cleanDropboxArtifacts();
});

test("process-dropbox refuses real ingest without a user id before side effects", () => {
  const fileName = `manual-${testPrefix}-no-user.csv`;
  const filePath = writeDropboxFile(fileName);

  const result = runProcessDropbox(["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(existsSync(filePath), true, "the source CSV must not be moved");
  assert.equal(result.commandLog, "", "no upload or ETL command should run");
});

test("process-dropbox dry run previews files without a user id or side effects", () => {
  const fileName = `chase-${testPrefix}-dry-run.csv`;
  const filePath = writeDropboxFile(fileName);
  const sidecarPath = `${filePath}.context.json`;
  writeFileSync(sidecarPath, JSON.stringify({ userId: "sidecar-user" }));

  const result = runProcessDropbox(["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(result.stdout, new RegExp(`${fileName}\\s+->\\s+chase`));
  assert.match(result.stdout, /\(\+ sidecar/);
  assert.equal(existsSync(filePath), true, "dry run must leave the CSV in place");
  assert.equal(existsSync(sidecarPath), true, "dry run must leave the sidecar in place");
  assert.equal(result.commandLog, "", "dry run must not upload or run ETL");
});

test("process-dropbox uploads, archives sidecars, and forwards the explicit user id", () => {
  const fileName = `capital_one-${testPrefix}-upload.csv`;
  const filePath = writeDropboxFile(fileName);
  const sidecarName = `${fileName}.context.json`;
  const sidecarPath = `${filePath}.context.json`;
  writeFileSync(sidecarPath, JSON.stringify({ accountName: "Checking" }));

  const result = runProcessDropbox(["--no-dataform", "--user-id", "cli-user"], {
    ETL_MAX_FILES: "7",
    WAREHOUSE_IMPORT_USER_ID: "env-user",
    WAREHOUSE_LANDING_BUCKET: "test-landing-bucket",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.commandLog,
    new RegExp(
      `gcloud storage cp .*/${fileName} gs://test-landing-bucket/incoming/capital_one/\\d{4}/\\d{2}/\\d{2}/${fileName}`,
    ),
  );
  assert.match(
    result.commandLog,
    new RegExp(
      `gcloud storage cp .*/${sidecarName} gs://test-landing-bucket/incoming/capital_one/\\d{4}/\\d{2}/\\d{2}/${sidecarName}`,
    ),
  );
  assert.match(
    result.commandLog,
    /npm run etl:runner -- --gcs-bucket test-landing-bucket --max-files 7 --user-id cli-user/,
  );
  assert.doesNotMatch(result.commandLog, /env-user/);

  assert.equal(existsSync(filePath), false, "uploaded CSV should leave the active dropbox");
  assert.equal(existsSync(sidecarPath), false, "uploaded sidecar should leave the active dropbox");
  assert.deepEqual(
    findDropboxArtifact(fileName).map((path) => basename(path)),
    [fileName],
  );
  assert.deepEqual(
    findDropboxArtifact(sidecarName).map((path) => basename(path)),
    [sidecarName],
  );
});
