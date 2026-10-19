import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const dropboxDirectory = join(repoRoot, "dropbox");
const envLocalPath = join(repoRoot, ".env.local");
const scriptPath = join(repoRoot, "scripts/process-dropbox.sh");
const fixtureDate = "2026-04-13";
const testFileNames = [
  "chase-user-required.csv",
  "discover-dry-run.csv",
  "apple_card-env-default.csv",
  "capital_one-cli-user.csv",
];

function removeIfExists(path) {
  rmSync(path, { force: true, recursive: true });
}

function cleanTestFiles() {
  for (const fileName of testFileNames) {
    removeIfExists(join(dropboxDirectory, fileName));
    removeIfExists(join(dropboxDirectory, `${fileName}.context.json`));
    removeIfExists(join(dropboxDirectory, "_uploaded", fixtureDate, fileName));
    removeIfExists(join(dropboxDirectory, "_uploaded", fixtureDate, `${fileName}.context.json`));
  }
}

function writeDropboxFile(fileName, contents = "Date,Description,Amount\n2026-04-13,Coffee,-4.25\n") {
  const filePath = join(dropboxDirectory, fileName);
  writeFileSync(filePath, contents, "utf8");
  return filePath;
}

function withEnvLocal(contents, callback) {
  const hadEnvLocal = existsSync(envLocalPath);
  const previousContents = hadEnvLocal ? readFileSync(envLocalPath, "utf8") : null;

  if (contents === null) {
    removeIfExists(envLocalPath);
  } else {
    writeFileSync(envLocalPath, contents, "utf8");
  }

  try {
    return callback();
  } finally {
    if (hadEnvLocal) {
      writeFileSync(envLocalPath, previousContents, "utf8");
    } else {
      removeIfExists(envLocalPath);
    }
  }
}

function makeExecutable(path, contents) {
  writeFileSync(path, contents, "utf8");
  chmodSync(path, 0o755);
}

function createFakeBin() {
  const directory = mkdtempSync(join(tmpdir(), "finance-dropbox-bin-"));

  makeExecutable(
    join(directory, "date"),
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
    makeExecutable(
      join(directory, command),
      `#!/usr/bin/env bash
{
  printf '${command}'
  for arg in "$@"; do
    printf ' %q' "$arg"
  done
  printf '\\n'
} >> "$COMMAND_LOG"
`,
    );
  }

  return directory;
}

function runDropboxScript(args = [], env = {}) {
  const fakeBin = createFakeBin();
  const commandLog = join(fakeBin, "commands.log");
  const childEnv = {
    ...process.env,
    ...env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    COMMAND_LOG: commandLog,
  };

  delete childEnv.WAREHOUSE_IMPORT_USER_ID;
  delete childEnv.WAREHOUSE_LANDING_BUCKET;
  delete childEnv.ETL_MAX_FILES;
  Object.assign(childEnv, env);

  const result = spawnSync("bash", [scriptPath, ...args], {
    cwd: repoRoot,
    env: childEnv,
    encoding: "utf8",
  });

  return {
    ...result,
    commandLog: existsSync(commandLog) ? readFileSync(commandLog, "utf8") : "",
  };
}

test("Dropbox ingest refuses non-dry-run imports without a user id before side effects", () => {
  cleanTestFiles();

  try {
    withEnvLocal(null, () => {
      const filePath = writeDropboxFile("chase-user-required.csv");
      const result = runDropboxScript(["--no-dataform"]);

      assert.equal(result.status, 2);
      assert.match(result.stderr, /Refusing to ingest without a user id/);
      assert.match(result.stderr, /WAREHOUSE_IMPORT_USER_ID/);
      assert.equal(result.commandLog, "");
      assert.equal(existsSync(filePath), true);
      assert.equal(
        existsSync(join(dropboxDirectory, "_uploaded", fixtureDate, "chase-user-required.csv")),
        false,
      );
    });
  } finally {
    cleanTestFiles();
  }
});

test("Dropbox ingest dry run remains safe without credentials or a user id", () => {
  cleanTestFiles();

  try {
    withEnvLocal(null, () => {
      const filePath = writeDropboxFile("discover-dry-run.csv");
      writeFileSync(`${filePath}.context.json`, '{"accountName":"Discover"}\n', "utf8");

      const result = runDropboxScript(["--dry-run"]);

      assert.equal(result.status, 0);
      assert.match(result.stdout, /discover-dry-run\.csv\s+->\s+discover/);
      assert.match(result.stdout, /\(\+ sidecar discover-dry-run\.csv\.context\.json\)/);
      assert.match(result.stdout, /Dry run complete/);
      assert.equal(result.commandLog, "");
      assert.equal(existsSync(filePath), true);
      assert.equal(existsSync(`${filePath}.context.json`), true);
    });
  } finally {
    cleanTestFiles();
  }
});

test("Dropbox ingest loads .env.local defaults and archives uploaded CSV sidecars", () => {
  cleanTestFiles();

  try {
    withEnvLocal(
      'WAREHOUSE_IMPORT_USER_ID="env-user-123"\nWAREHOUSE_LANDING_BUCKET=env-bucket\n',
      () => {
        const filePath = writeDropboxFile("apple_card-env-default.csv");
        writeFileSync(`${filePath}.context.json`, '{"accountMask":"1234"}\n', "utf8");

        const result = runDropboxScript(["--no-dataform"], {
          ETL_MAX_FILES: "7",
        });

        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Bucket: gs:\/\/env-bucket/);
        assert.match(result.stdout, /uploaded sidecar context\.json/);
        assert.match(
          result.commandLog,
          new RegExp(
            String.raw`gcloud storage cp .*/dropbox/apple_card-env-default\.csv gs://env-bucket/incoming/apple_card/2026/04/13/apple_card-env-default\.csv`,
          ),
        );
        assert.match(
          result.commandLog,
          new RegExp(
            String.raw`gcloud storage cp .*/dropbox/apple_card-env-default\.csv\.context\.json gs://env-bucket/incoming/apple_card/2026/04/13/apple_card-env-default\.csv\.context\.json`,
          ),
        );
        assert.match(
          result.commandLog,
          /npm run etl:runner -- --gcs-bucket env-bucket --max-files 7 --user-id env-user-123/,
        );
        assert.doesNotMatch(result.commandLog, /^npx /m);
        assert.equal(existsSync(filePath), false);
        assert.equal(
          existsSync(join(dropboxDirectory, "_uploaded", fixtureDate, "apple_card-env-default.csv")),
          true,
        );
        assert.equal(
          existsSync(
            join(dropboxDirectory, "_uploaded", fixtureDate, "apple_card-env-default.csv.context.json"),
          ),
          true,
        );
      },
    );
  } finally {
    cleanTestFiles();
  }
});

test("Dropbox ingest lets --user-id override the .env.local import user", () => {
  cleanTestFiles();

  try {
    withEnvLocal(
      "WAREHOUSE_IMPORT_USER_ID=env-user-should-not-win\nWAREHOUSE_LANDING_BUCKET=override-bucket\n",
      () => {
        writeDropboxFile("capital_one-cli-user.csv");

        const result = runDropboxScript(["--no-dataform", "--user-id", "cli-user-456"]);

        assert.equal(result.status, 0, result.stderr);
        assert.match(
          result.commandLog,
          /npm run etl:runner -- --gcs-bucket override-bucket --max-files 50 --user-id cli-user-456/,
        );
        assert.doesNotMatch(result.commandLog, /env-user-should-not-win/);
      },
    );
  } finally {
    cleanTestFiles();
  }
});
