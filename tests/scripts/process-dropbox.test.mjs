import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const processDropboxScript = readFileSync(
  join(process.cwd(), "scripts/process-dropbox.sh"),
  "utf8",
);

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createSandbox() {
  const root = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const binDirectory = join(root, "bin");
  const dropboxDirectory = join(root, "dropbox");
  const scriptsDirectory = join(root, "scripts");
  const invocationsPath = join(root, "invocations.log");

  mkdirSync(binDirectory, { recursive: true });
  mkdirSync(dropboxDirectory, { recursive: true });
  mkdirSync(scriptsDirectory, { recursive: true });
  writeFileSync(join(scriptsDirectory, "process-dropbox.sh"), processDropboxScript, "utf8");
  writeFileSync(invocationsPath, "", "utf8");

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

  for (const command of ["gcloud", "npm", "npx"]) {
    writeExecutable(
      join(binDirectory, command),
      `#!/usr/bin/env bash
printf '${command}' >> "$INVOCATIONS_LOG"
for arg in "$@"; do
  printf '\\t%s' "$arg" >> "$INVOCATIONS_LOG"
done
printf '\\n' >> "$INVOCATIONS_LOG"
`,
    );
  }

  return {
    root,
    binDirectory,
    dropboxDirectory,
    invocationsPath,
    scriptPath: join(scriptsDirectory, "process-dropbox.sh"),
  };
}

function runProcessDropbox(sandbox, args = [], env = {}) {
  return spawnSync("bash", [sandbox.scriptPath, ...args], {
    cwd: sandbox.root,
    encoding: "utf8",
    env: {
      ...process.env,
      ETL_MAX_FILES: "",
      INVOCATIONS_LOG: sandbox.invocationsPath,
      PATH: `${sandbox.binDirectory}:${process.env.PATH}`,
      WAREHOUSE_IMPORT_USER_ID: "",
      WAREHOUSE_LANDING_BUCKET: "",
      ...env,
    },
  });
}

function readInvocations(sandbox) {
  return readFileSync(sandbox.invocationsPath, "utf8");
}

test("Dropbox ingest refuses real uploads without a user id before side effects", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "chase-card.csv");
  writeFileSync(csvPath, "Transaction Date,Description,Amount\n2026-04-13,Coffee,-4.50\n");

  const result = runProcessDropbox(sandbox, ["--no-dataform"]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(readInvocations(sandbox), "");
  assert.equal(existsSync(csvPath), true);
});

test("Dropbox ingest dry run remains safe without a user id", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "discover-card.csv");
  writeFileSync(csvPath, "Trans. Date,Description,Amount\n04/13/2026,Coffee,-4.50\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Discover"}\n');

  const result = runProcessDropbox(sandbox, ["--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.match(result.stdout, /\(\+ sidecar discover-card\.csv\.context\.json\)/);
  assert.equal(readInvocations(sandbox), "");
  assert.equal(existsSync(csvPath), true);
  assert.equal(existsSync(`${csvPath}.context.json`), true);
});

test("Dropbox ingest loads .env.local defaults and forwards the user id to the runner", () => {
  const sandbox = createSandbox();
  const csvPath = join(sandbox.dropboxDirectory, "capital_one-checking.csv");
  writeFileSync(csvPath, "Transaction Date,Description,Debit,Credit\n2026-04-13,Coffee,4.50,\n");
  writeFileSync(`${csvPath}.context.json`, '{"accountName":"Capital One 360"}\n');
  writeFileSync(
    join(sandbox.root, ".env.local"),
    'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=\'custom-bucket\'\n',
  );

  const result = runProcessDropbox(sandbox, ["--no-dataform"], {
    ETL_MAX_FILES: "7",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Bucket: gs:\/\/custom-bucket/);

  const invocations = readInvocations(sandbox);
  assert.match(
    invocations,
    /gcloud\tstorage\tcp\t.*capital_one-checking\.csv\tgs:\/\/custom-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv/,
  );
  assert.match(
    invocations,
    /gcloud\tstorage\tcp\t.*capital_one-checking\.csv\.context\.json\tgs:\/\/custom-bucket\/incoming\/capital_one\/2026\/04\/13\/capital_one-checking\.csv\.context\.json/,
  );
  assert.match(
    invocations,
    /npm\trun\tetl:runner\t--\t--gcs-bucket\tcustom-bucket\t--max-files\t7\t--user-id\tenv-user-123/,
  );
  assert.doesNotMatch(invocations, /^npx\t/m);
  assert.equal(
    existsSync(
      join(
        sandbox.dropboxDirectory,
        "_uploaded",
        "2026-04-13",
        "capital_one-checking.csv",
      ),
    ),
    true,
  );
  assert.equal(
    existsSync(
      join(
        sandbox.dropboxDirectory,
        "_uploaded",
        "2026-04-13",
        "capital_one-checking.csv.context.json",
      ),
    ),
    true,
  );
});
