import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const processDropboxScript = readFileSync(
  join(process.cwd(), "scripts/process-dropbox.sh"),
  "utf8",
);

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-process-dropbox-"));
  const scriptPath = join(root, "scripts/process-dropbox.sh");
  const dropboxPath = join(root, "dropbox");
  const binPath = join(root, "bin");
  const commandLogPath = join(root, "commands.log");

  mkdirSync(dirname(scriptPath), { recursive: true });
  mkdirSync(dropboxPath, { recursive: true });
  mkdirSync(binPath, { recursive: true });
  writeFileSync(scriptPath, processDropboxScript, "utf8");
  chmodSync(scriptPath, 0o755);

  return {
    root,
    scriptPath,
    dropboxPath,
    binPath,
    commandLogPath,
  };
}

function writeDropboxCsv(sandbox, fileName = "discover-export.csv") {
  const filePath = join(sandbox.dropboxPath, fileName);

  writeFileSync(
    filePath,
    "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n",
    "utf8",
  );
  return filePath;
}

function writeExecutable(filePath, contents) {
  writeFileSync(filePath, contents, "utf8");
  chmodSync(filePath, 0o755);
}

function installCommandStubs(sandbox) {
  writeExecutable(
    join(sandbox.binPath, "gcloud"),
    `#!/usr/bin/env bash
echo "gcloud $*" >> "${sandbox.commandLogPath}"
`,
  );
  writeExecutable(
    join(sandbox.binPath, "npm"),
    `#!/usr/bin/env bash
echo "npm $*" >> "${sandbox.commandLogPath}"
`,
  );
  writeExecutable(
    join(sandbox.binPath, "npx"),
    `#!/usr/bin/env bash
echo "npx $*" >> "${sandbox.commandLogPath}"
exit 99
`,
  );
}

function runProcessDropbox(sandbox, args = [], env = {}) {
  return new Promise((resolve) => {
    execFile(
      sandbox.scriptPath,
      args,
      {
        cwd: sandbox.root,
        env: {
          PATH: `${sandbox.binPath}:${process.env.PATH}`,
          HOME: sandbox.root,
          ...env,
        },
      },
      (error, stdout, stderr) => {
        resolve({
          code:
            typeof error?.code === "number"
              ? error.code
              : error
                ? 1
                : 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

test("process-dropbox refuses real ingest when no user id is configured", async () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox);

  const result = await runProcessDropbox(sandbox);

  assert.equal(result.code, 2);
  assert.match(
    result.stderr,
    /Refusing to ingest without a user id\. CSV rows would land with user_id NULL/,
  );
  assert.match(
    result.stderr,
    /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id\./,
  );
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sandbox.commandLogPath), false);
});

test("process-dropbox dry runs do not require a user id or mutate files", async () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox, "capital_one-checking.csv");

  const result = await runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.code, 0);
  assert.match(result.stdout, /capital_one-checking\.csv  ->  capital_one/);
  assert.match(
    result.stdout,
    /Dry run complete\. No files were uploaded or processed\./,
  );
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sandbox.commandLogPath), false);
});

test("process-dropbox loads .env.local user and bucket values before running ETL", async () => {
  const sandbox = createSandbox();
  const csvPath = writeDropboxCsv(sandbox, "chase-activity.csv");
  installCommandStubs(sandbox);
  writeFileSync(
    join(sandbox.root, ".env.local"),
    [
      "WAREHOUSE_IMPORT_USER_ID='app-user-123'",
      'WAREHOUSE_LANDING_BUCKET="custom-landing-bucket"',
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.code, 0);
  assert.equal(existsSync(csvPath), false);

  const commandLog = readFileSync(sandbox.commandLogPath, "utf8");
  assert.match(
    commandLog,
    new RegExp(
      [
        "gcloud storage cp .*/dropbox/chase-activity\\.csv ",
        "gs://custom-landing-bucket/incoming/chase/",
        "\\d{4}/\\d{2}/\\d{2}/chase-activity\\.csv",
      ].join(""),
    ),
  );
  assert.match(
    commandLog,
    /npm run etl:runner -- --gcs-bucket custom-landing-bucket --max-files 50 --user-id app-user-123/,
  );
  assert.doesNotMatch(commandLog, /^npx /m);
});
