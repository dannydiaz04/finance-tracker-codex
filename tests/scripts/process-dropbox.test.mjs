import assert from "node:assert/strict";
import {
  chmodSync,
  copyFileSync,
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

const sourceScript = join(process.cwd(), "scripts/process-dropbox.sh");

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDirectory = join(root, "scripts");
  const dropboxDirectory = join(root, "dropbox");
  const binDirectory = join(root, "bin");
  const commandLog = join(root, "commands.log");

  mkdirSync(scriptsDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(binDirectory, { recursive: true });
  copyFileSync(sourceScript, join(scriptsDirectory, "process-dropbox.sh"));
  chmodSync(join(scriptsDirectory, "process-dropbox.sh"), 0o755);

  writeExecutable(
    join(binDirectory, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );
  writeExecutable(
    join(binDirectory, "gcloud"),
    `#!/usr/bin/env bash
printf 'gcloud %s\\n' "$*" >> "${commandLog}"
`,
  );
  writeExecutable(
    join(binDirectory, "npm"),
    `#!/usr/bin/env bash
printf 'npm %s\\n' "$*" >> "${commandLog}"
`,
  );
  writeExecutable(
    join(binDirectory, "npx"),
    `#!/usr/bin/env bash
printf 'npx %s\\n' "$*" >> "${commandLog}"
`,
  );

  return {
    root,
    script: join(scriptsDirectory, "process-dropbox.sh"),
    dropboxDirectory,
    commandLog,
    env: {
      PATH: `${binDirectory}:${process.env.PATH}`,
      HOME: root,
      TZ: "UTC",
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runScript(sandbox, args = [], env = {}) {
  return spawnSync("bash", [sandbox.script, ...args], {
    cwd: sandbox.root,
    env: {
      ...sandbox.env,
      ...env,
    },
    encoding: "utf8",
  });
}

function writeCsv(sandbox, name = "chase-activity.csv") {
  const filePath = join(sandbox.dropboxDirectory, name);
  writeFileSync(filePath, "Date,Description,Amount\n2026-04-12,Coffee,4.25\n", "utf8");
  return filePath;
}

function readCommandLog(sandbox) {
  return existsSync(sandbox.commandLog)
    ? readFileSync(sandbox.commandLog, "utf8")
    : "";
}

test("Dropbox ingest refuses a real run without a user id before side effects", () => {
  const sandbox = createSandbox();

  try {
    const csvPath = writeCsv(sandbox);
    const result = runScript(sandbox, ["--no-dataform"]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Refusing to ingest without a user id/);
    assert.equal(readCommandLog(sandbox), "");
    assert.equal(existsSync(csvPath), true);
  } finally {
    sandbox.cleanup();
  }
});

test("Dropbox ingest dry run stays safe without a user id", () => {
  const sandbox = createSandbox();

  try {
    const csvPath = writeCsv(sandbox, "discover-export.csv");
    const result = runScript(sandbox, ["--dry-run"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Dry run complete/);
    assert.match(
      result.stdout,
      /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/discover\/2026\/04\/13\/discover-export\.csv/,
    );
    assert.equal(readCommandLog(sandbox), "");
    assert.equal(existsSync(csvPath), true);
  } finally {
    sandbox.cleanup();
  }
});

test("Dropbox ingest loads .env.local defaults and forwards the user id to the ETL runner", () => {
  const sandbox = createSandbox();

  try {
    const csvPath = writeCsv(sandbox, "capital_one-checking.csv");
    writeFileSync(`${csvPath}.context.json`, '{"accountName":"Checking"}\n', "utf8");
    writeFileSync(
      join(sandbox.root, ".env.local"),
      [
        "WAREHOUSE_IMPORT_USER_ID='env-user-123'",
        'WAREHOUSE_LANDING_BUCKET="env-finance-bucket"',
        "",
      ].join("\n"),
      "utf8",
    );

    const result = runScript(sandbox, ["--no-dataform"]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Uploaded 1 file/);

    const commandLog = readCommandLog(sandbox);
    assert.match(
      commandLog,
      /gcloud storage cp .*capital_one-checking\.csv gs:\/\/env-finance-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv/,
    );
    assert.match(
      commandLog,
      /gcloud storage cp .*capital_one-checking\.csv\.context\.json gs:\/\/env-finance-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv\.context\.json/,
    );
    assert.match(
      commandLog,
      /npm run etl:runner -- --gcs-bucket env-finance-bucket --max-files 50 --user-id env-user-123/,
    );
    assert.doesNotMatch(commandLog, /^npx /m);

    const archiveDirectory = join(sandbox.dropboxDirectory, "_uploaded", "2026-04-13");
    assert.deepEqual(
      readdirSync(archiveDirectory).sort(),
      ["capital_one-checking.csv", "capital_one-checking.csv.context.json"],
    );
  } finally {
    sandbox.cleanup();
  }
});

test("Dropbox ingest prefers explicit --user-id over environment defaults", () => {
  const sandbox = createSandbox();

  try {
    writeCsv(sandbox, "apple_card-transactions.csv");

    const result = runScript(sandbox, ["--no-dataform", "--user-id", "cli-user-456"], {
      WAREHOUSE_IMPORT_USER_ID: "env-user-123",
      WAREHOUSE_LANDING_BUCKET: "cli-test-bucket",
      ETL_MAX_FILES: "7",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(
      readCommandLog(sandbox),
      /npm run etl:runner -- --gcs-bucket cli-test-bucket --max-files 7 --user-id cli-user-456/,
    );

    const archiveDirectory = join(sandbox.dropboxDirectory, "_uploaded", "2026-04-13");
    assert.deepEqual(readdirSync(archiveDirectory), ["apple_card-transactions.csv"]);
  } finally {
    sandbox.cleanup();
  }
});
