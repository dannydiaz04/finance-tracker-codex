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

const sourceScriptPath = join(process.cwd(), "scripts/process-dropbox.sh");

function createProcessDropboxFixture({ envFile } = {}) {
  const repoRoot = mkdtempSync(join(tmpdir(), "finance-tracker-dropbox-"));
  const scriptsDir = join(repoRoot, "scripts");
  const dropboxDir = join(repoRoot, "dropbox");
  const binDir = join(repoRoot, "bin");
  const callLogPath = join(repoRoot, "calls.log");

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(dropboxDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptPath = join(scriptsDir, "process-dropbox.sh");
  writeFileSync(scriptPath, readFileSync(sourceScriptPath, "utf8"), "utf8");

  if (envFile) {
    writeFileSync(join(repoRoot, ".env.local"), envFile, "utf8");
  }

  writeFileSync(join(dropboxDir, "chase-export.csv"), "Date,Description,Amount\n2026-04-13,Coffee,-4.50\n", "utf8");
  writeFileSync(
    join(dropboxDir, "chase-export.csv.context.json"),
    `${JSON.stringify({ sourceAccountId: "chase_card" }, null, 2)}\n`,
    "utf8",
  );

  for (const command of ["gcloud", "npm", "npx"]) {
    const stubPath = join(binDir, command);
    writeFileSync(
      stubPath,
      "#!/usr/bin/env bash\n" +
        `echo "${command} $*" >> "$CALL_LOG"\n` +
        "exit 0\n",
      "utf8",
    );
    chmodSync(stubPath, 0o755);
  }

  const baseEnv = {
    PATH: `${binDir}:${process.env.PATH}`,
    CALL_LOG: callLogPath,
  };

  return {
    repoRoot,
    scriptPath,
    dropboxDir,
    callLogPath,
    run(args = [], env = {}) {
      return spawnSync("bash", [scriptPath, ...args], {
        cwd: repoRoot,
        env: {
          ...baseEnv,
          ...env,
        },
        encoding: "utf8",
      });
    },
    calls() {
      return existsSync(callLogPath) ? readFileSync(callLogPath, "utf8") : "";
    },
  };
}

test("process-dropbox refuses real ingest without a user id before upload commands run", () => {
  const fixture = createProcessDropboxFixture();

  const result = fixture.run([], {
    WAREHOUSE_IMPORT_USER_ID: "",
    WAREHOUSE_LANDING_BUCKET: "test-bucket",
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Refusing to ingest without a user id/);
  assert.match(result.stderr, /Set WAREHOUSE_IMPORT_USER_ID in \.env\.local or pass --user-id/);
  assert.equal(fixture.calls(), "");
});

test("process-dropbox dry run remains available without a user id", () => {
  const fixture = createProcessDropboxFixture();

  const result = fixture.run(["--dry-run"], {
    WAREHOUSE_IMPORT_USER_ID: "",
    WAREHOUSE_LANDING_BUCKET: "test-bucket",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Found 1 file\(s\) in dropbox/);
  assert.match(result.stdout, /chase-export\.csv\s+->\s+chase/);
  assert.match(result.stdout, /\(\+ sidecar chase-export\.csv\.context\.json\)/);
  assert.match(result.stdout, /Dry run complete\. No files were uploaded or processed\./);
  assert.equal(fixture.calls(), "");
});

test("process-dropbox loads env-local user id and forwards it to the ETL runner", () => {
  const fixture = createProcessDropboxFixture({
    envFile: 'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET="env-bucket"\n',
  });

  const result = fixture.run(["--no-dataform"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(fixture.calls(), /gcloud storage cp .* gs:\/\/env-bucket\/incoming\/chase\//);
  assert.match(
    fixture.calls(),
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id env-user-123/,
  );
  assert.equal(existsSync(join(fixture.dropboxDir, "chase-export.csv")), false);
});

test("process-dropbox explicit user id overrides env-local user id", () => {
  const fixture = createProcessDropboxFixture({
    envFile: 'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET="env-bucket"\n',
  });

  const result = fixture.run(["--no-dataform", "--user-id", "cli-user-456"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    fixture.calls(),
    /npm run etl:runner -- --gcs-bucket env-bucket --max-files 50 --user-id cli-user-456/,
  );
  assert.doesNotMatch(fixture.calls(), /--user-id env-user-123/);
});
