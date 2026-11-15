import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repoRoot = process.cwd();
const processDropboxScript = readFileSync(
  join(repoRoot, "scripts/process-dropbox.sh"),
  "utf8",
);

function writeExecutable(path, contents) {
  writeFileSync(path, contents, { encoding: "utf8", mode: 0o755 });
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const fakeBin = join(root, "bin");
  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const logPath = join(root, "commands.log");

  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  writeExecutable(scriptPath, processDropboxScript);

  writeExecutable(
    join(fakeBin, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 04 ;;
  +%d) echo 13 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(fakeBin, command),
      `#!/usr/bin/env bash
{
  printf '${command}'
  for arg in "$@"; do
    printf '\\t%s' "$arg"
  done
  printf '\\n'
} >> "$PROCESS_DROPBOX_TEST_LOG"
`,
    );
  }

  function writeDropboxFile(relativePath, contents = "date,description,amount\n") {
    const path = join(dropboxDir, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, "utf8");
    return path;
  }

  function run(args = [], env = {}) {
    return spawnSync("bash", [scriptPath, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        HOME: root,
        PATH: `${fakeBin}:${process.env.PATH}`,
        PROCESS_DROPBOX_TEST_LOG: logPath,
        ...env,
      },
    });
  }

  function commandLog() {
    return existsSync(logPath) ? readFileSync(logPath, "utf8").trimEnd() : "";
  }

  return {
    root,
    dropboxDir,
    logPath,
    run,
    commandLog,
    writeDropboxFile,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("process-dropbox refuses non-dry-run ingest without a user id before side effects", () => {
  const harness = createHarness();

  try {
    const csvPath = harness.writeDropboxFile("chase-activity.csv");

    const result = harness.run(["--no-dataform"]);

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Refusing to ingest without a user id/);
    assert.match(result.stderr, /WAREHOUSE_IMPORT_USER_ID/);
    assert.equal(harness.commandLog(), "");
    assert.equal(existsSync(csvPath), true);
  } finally {
    harness.cleanup();
  }
});

test("process-dropbox dry-run previews classification and sidecars without credentials", () => {
  const harness = createHarness();

  try {
    const csvPath = harness.writeDropboxFile("Discover-Activity.csv");
    const sidecarPath = `${csvPath}.context.json`;
    writeFileSync(sidecarPath, '{"sourceAccountId":"discover"}\n', "utf8");

    const result = harness.run(["--dry-run"]);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Discover-Activity\.csv\s+->\s+discover/);
    assert.match(
      result.stdout,
      /gs:\/\/finance-tracker-cdx-etl-landing\/incoming\/discover\/2026\/04\/13\/Discover-Activity\.csv/,
    );
    assert.match(result.stdout, /\(\+ sidecar Discover-Activity\.csv\.context\.json\)/);
    assert.match(result.stdout, /Dry run complete/);
    assert.equal(harness.commandLog(), "");
    assert.equal(existsSync(csvPath), true);
    assert.equal(existsSync(sidecarPath), true);
  } finally {
    harness.cleanup();
  }
});

test("process-dropbox uploads sidecars, archives originals, and forwards the CLI user id", () => {
  const harness = createHarness();

  try {
    const csvPath = harness.writeDropboxFile("capital_one-checking.csv");
    const sidecarPath = `${csvPath}.context.json`;
    writeFileSync(sidecarPath, '{"sourceAccountId":"capital-one"}\n', "utf8");

    const result = harness.run(["--no-dataform", "--user-id", "app-user-42"], {
      ETL_MAX_FILES: "7",
      WAREHOUSE_LANDING_BUCKET: "test-landing-bucket",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Uploaded 1 file\(s\)/);

    const archivedCsv = join(
      harness.dropboxDir,
      "_uploaded/2026-04-13/capital_one-checking.csv",
    );
    const archivedSidecar = `${archivedCsv}.context.json`;
    assert.equal(existsSync(csvPath), false);
    assert.equal(existsSync(sidecarPath), false);
    assert.equal(existsSync(archivedCsv), true);
    assert.equal(existsSync(archivedSidecar), true);

    const log = harness.commandLog();
    assert.match(
      log,
      /gcloud\tstorage\tcp\t.*capital_one-checking\.csv\tgs:\/\/test-landing-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv/,
    );
    assert.match(
      log,
      /gcloud\tstorage\tcp\t.*capital_one-checking\.csv\.context\.json\tgs:\/\/test-landing-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv\.context\.json/,
    );
    assert.match(
      log,
      /npm\trun\tetl:runner\t--\t--gcs-bucket\ttest-landing-bucket\t--max-files\t7\t--user-id\tapp-user-42/,
    );
    assert.doesNotMatch(log, /^npx\t/m);
  } finally {
    harness.cleanup();
  }
});

test("process-dropbox reads .env.local defaults and lets --user-id override them", () => {
  const harness = createHarness();

  try {
    harness.writeDropboxFile("apple_card-april.csv");
    writeFileSync(
      join(harness.root, ".env.local"),
      'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
      "utf8",
    );

    const result = harness.run(["--no-dataform", "--user-id", "cli-user"]);

    assert.equal(result.status, 0, result.stderr);

    const log = harness.commandLog();
    assert.match(
      log,
      /gs:\/\/env-bucket\/incoming\/apple_card\/2026\/04\/13\/apple_card-april\.csv/,
    );
    assert.match(
      log,
      /npm\trun\tetl:runner\t--\t--gcs-bucket\tenv-bucket\t--max-files\t50\t--user-id\tcli-user/,
    );
    assert.doesNotMatch(log, /env-user/);
  } finally {
    harness.cleanup();
  }
});
