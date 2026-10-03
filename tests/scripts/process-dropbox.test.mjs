import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SOURCE_SCRIPT = new URL("../../scripts/process-dropbox.sh", import.meta.url);

function writeExecutable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function createHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "process-dropbox-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const scriptsDir = join(root, "scripts");
  const dropboxDir = join(root, "dropbox");
  const binDir = join(root, "bin");
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  writeExecutable(scriptPath, readFileSync(SOURCE_SCRIPT, "utf8"));

  const commandLog = join(root, "commands.log");
  writeFileSync(commandLog, "");

  writeExecutable(
    join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 08 ;;
  +%d) echo 12 ;;
  *) /bin/date "$@" ;;
esac
`,
  );
  writeExecutable(
    join(binDir, "gcloud"),
    `#!/usr/bin/env bash
printf 'gcloud' >> "$COMMAND_LOG"
for arg in "$@"; do
  printf '|%s' "$arg" >> "$COMMAND_LOG"
done
printf '\\n' >> "$COMMAND_LOG"
`,
  );
  writeExecutable(
    join(binDir, "npm"),
    `#!/usr/bin/env bash
printf 'npm' >> "$COMMAND_LOG"
for arg in "$@"; do
  printf '|%s' "$arg" >> "$COMMAND_LOG"
done
printf '\\n' >> "$COMMAND_LOG"
`,
  );
  writeExecutable(
    join(binDir, "npx"),
    `#!/usr/bin/env bash
printf 'npx' >> "$COMMAND_LOG"
for arg in "$@"; do
  printf '|%s' "$arg" >> "$COMMAND_LOG"
done
printf '\\n' >> "$COMMAND_LOG"
`,
  );

  function run(args = [], envOverrides = {}) {
    const env = { ...process.env };
    delete env.WAREHOUSE_IMPORT_USER_ID;
    delete env.WAREHOUSE_LANDING_BUCKET;
    delete env.ETL_MAX_FILES;
    Object.assign(env, envOverrides, {
      COMMAND_LOG: commandLog,
      PATH: `${binDir}:${process.env.PATH}`,
    });

    return spawnSync("bash", [scriptPath, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
    });
  }

  return {
    root,
    dropboxDir,
    commandLog,
    run,
    commands() {
      return readFileSync(commandLog, "utf8");
    },
  };
}

test("process-dropbox refuses real ingest without a user id before side effects", (t) => {
  const harness = createHarness(t);
  const csvPath = join(harness.dropboxDir, "chase-april.csv");
  writeFileSync(csvPath, "date,description,amount\n2026-08-01,Store,1.23\n");

  const result = harness.run(["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(harness.commands(), "");
  assert.equal(readFileSync(csvPath, "utf8"), "date,description,amount\n2026-08-01,Store,1.23\n");
});

test("process-dropbox dry run previews files without requiring credentials or mutating files", (t) => {
  const harness = createHarness(t);
  const csvPath = join(harness.dropboxDir, "apple_card-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-08-01,App Store,9.99\n");
  writeFileSync(sidecarPath, '{"accountName":"Apple Card"}\n');

  const result = harness.run(["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /apple_card-export\.csv\s+->\s+apple_card/);
  assert.match(result.stdout, /\(\+ sidecar apple_card-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete/);
  assert.equal(harness.commands(), "");
  assert.equal(readFileSync(csvPath, "utf8"), "Transaction Date,Description,Amount\n2026-08-01,App Store,9.99\n");
  assert.equal(readFileSync(sidecarPath, "utf8"), '{"accountName":"Apple Card"}\n');
});

test("process-dropbox loads env-local user and bucket, uploads sidecars, archives, and forwards user id", (t) => {
  const harness = createHarness(t);
  const csvPath = join(harness.dropboxDir, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  writeFileSync(join(harness.root, ".env.local"), [
    'WAREHOUSE_IMPORT_USER_ID="user-from-env"',
    "WAREHOUSE_LANDING_BUCKET='landing-from-env'",
    "",
  ].join("\n"));
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-08-01,Deposit,100.00\n");
  writeFileSync(sidecarPath, '{"sourceAccountId":"checking"}\n');

  const result = harness.run(["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Uploaded 1 file\(s\)/);
  assert.match(harness.commands(), new RegExp([
    "gcloud\\|storage\\|cp\\|",
    csvPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "\\|gs://landing-from-env/incoming/capital_one/2026/08/12/capital_one-checking\\.csv",
  ].join("")));
  assert.match(harness.commands(), /gcloud\|storage\|cp\|.*capital_one-checking\.csv\.context\.json\|gs:\/\/landing-from-env\/incoming\/capital_one\/2026\/08\/12\/capital_one-checking\.csv\.context\.json/);
  assert.match(
    harness.commands(),
    /npm\|run\|etl:runner\|--\|--gcs-bucket\|landing-from-env\|--max-files\|50\|--user-id\|user-from-env/,
  );
  assert.doesNotMatch(harness.commands(), /npx\|dataform/);
  assert.equal(
    readFileSync(join(harness.dropboxDir, "_uploaded", "2026-08-12", "capital_one-checking.csv"), "utf8"),
    "Transaction Date,Description,Amount\n2026-08-01,Deposit,100.00\n",
  );
  assert.equal(
    readFileSync(join(harness.dropboxDir, "_uploaded", "2026-08-12", "capital_one-checking.csv.context.json"), "utf8"),
    '{"sourceAccountId":"checking"}\n',
  );
});

test("process-dropbox command line user id overrides env-local default", (t) => {
  const harness = createHarness(t);
  writeFileSync(join(harness.root, ".env.local"), [
    "WAREHOUSE_IMPORT_USER_ID=user-from-env",
    "WAREHOUSE_LANDING_BUCKET=landing-from-env",
    "",
  ].join("\n"));
  writeFileSync(join(harness.dropboxDir, "discover.csv"), "date,description,amount\n2026-08-01,Store,12.34\n");

  const result = harness.run(["--no-dataform", "--user-id", "user-from-cli"], {
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    harness.commands(),
    /npm\|run\|etl:runner\|--\|--gcs-bucket\|landing-from-env\|--max-files\|7\|--user-id\|user-from-cli/,
  );
});
