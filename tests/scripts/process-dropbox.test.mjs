import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const sourceScript = path.join(repoRoot, "scripts/process-dropbox.sh");

async function makeHarness(t) {
  const root = await mkdtemp(path.join(tmpdir(), "process-dropbox-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const scriptsDir = path.join(root, "scripts");
  const dropboxDir = path.join(root, "dropbox");
  const binDir = path.join(root, "bin");
  const commandLog = path.join(root, "commands.log");
  const script = path.join(scriptsDir, "process-dropbox.sh");

  await mkdir(scriptsDir, { recursive: true });
  await mkdir(dropboxDir, { recursive: true });
  await mkdir(binDir, { recursive: true });
  await symlink(sourceScript, script);

  await writeExecutable(
    path.join(binDir, "date"),
    `#!/usr/bin/env bash
case "$1" in
  +%Y) echo 2026 ;;
  +%m) echo 10 ;;
  +%d) echo 15 ;;
  *) /usr/bin/date "$@" ;;
esac
`,
  );
  await writeExecutable(
    path.join(binDir, "gcloud"),
    `#!/usr/bin/env bash
echo "gcloud $*" >> "$COMMAND_LOG"
`,
  );
  await writeExecutable(
    path.join(binDir, "npm"),
    `#!/usr/bin/env bash
echo "npm $*" >> "$COMMAND_LOG"
`,
  );
  await writeExecutable(
    path.join(binDir, "npx"),
    `#!/usr/bin/env bash
echo "npx $*" >> "$COMMAND_LOG"
`,
  );

  function run(args = [], env = {}) {
    return spawnSync("bash", [script, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        COMMAND_LOG: commandLog,
        ETL_MAX_FILES: "",
        PATH: `${binDir}:${process.env.PATH}`,
        WAREHOUSE_IMPORT_USER_ID: "",
        WAREHOUSE_LANDING_BUCKET: "",
        ...env,
      },
    });
  }

  async function commands() {
    if (!existsSync(commandLog)) {
      return "";
    }
    return readFile(commandLog, "utf8");
  }

  return { commands, dropboxDir, root, run };
}

async function writeExecutable(filePath, contents) {
  await writeFile(filePath, contents, { mode: 0o755 });
}

test("refuses non-dry-run ingest without a user id before side effects", async (t) => {
  const harness = await makeHarness(t);
  const csvPath = path.join(harness.dropboxDir, "chase-activity.csv");
  await writeFile(csvPath, "Date,Description,Amount\n2026-10-14,Coffee,-4.50\n");

  const result = harness.run();

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.equal(await harness.commands(), "");
  assert.equal(existsSync(csvPath), true, "the source CSV should remain in dropbox");
});

test("dry-run stays safe without credentials or a user id", async (t) => {
  const harness = await makeHarness(t);
  const csvPath = path.join(harness.dropboxDir, "discover-export.csv");
  const sidecarPath = `${csvPath}.context.json`;
  await writeFile(csvPath, "Trans. Date,Description,Amount\n2026-10-14,Groceries,-42.00\n");
  await writeFile(sidecarPath, '{"account":"discover"}\n');

  const result = harness.run(["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete/);
  assert.match(result.stdout, /\(\+ sidecar discover-export\.csv\.context\.json\)/);
  assert.equal(await harness.commands(), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(sidecarPath), true);
});

test(".env.local supplies the landing bucket and import user id", async (t) => {
  const harness = await makeHarness(t);
  const csvPath = path.join(harness.dropboxDir, "capital_one-checking.csv");
  const sidecarPath = `${csvPath}.context.json`;
  await writeFile(
    path.join(harness.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
  );
  await writeFile(csvPath, "Transaction Date,Description,Amount\n2026-10-14,Payroll,1000\n");
  await writeFile(sidecarPath, '{"account":"checking"}\n');

  const result = harness.run(["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  const commands = await harness.commands();
  assert.match(
    commands,
    /gcloud storage cp .*capital_one-checking\.csv gs:\/\/env-bucket\/incoming\/capital_one\/2026\/10\/15\/capital_one-checking\.csv/,
  );
  assert.match(
    commands,
    /gcloud storage cp .*capital_one-checking\.csv\.context\.json gs:\/\/env-bucket\/incoming\/capital_one\/2026\/10\/15\/capital_one-checking\.csv\.context\.json/,
  );
  assert.match(
    commands,
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user/,
  );
  assert.doesNotMatch(commands, /^npx /m);
  assert.equal(
    existsSync(path.join(harness.dropboxDir, "_uploaded/2026-10-15/capital_one-checking.csv")),
    true,
  );
  assert.equal(
    existsSync(path.join(harness.dropboxDir, "_uploaded/2026-10-15/capital_one-checking.csv.context.json")),
    true,
  );
});

test("--user-id overrides the .env.local import user", async (t) => {
  const harness = await makeHarness(t);
  await writeFile(
    path.join(harness.root, ".env.local"),
    "WAREHOUSE_IMPORT_USER_ID=env-user\nWAREHOUSE_LANDING_BUCKET=env-bucket\n",
  );
  await writeFile(
    path.join(harness.dropboxDir, "manual-upload.csv"),
    "Date,Description,Amount\n2026-10-14,Adjustment,12.34\n",
  );

  const result = harness.run(["--no-dataform", "--user-id", "cli-user"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    await harness.commands(),
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user/,
  );
});
