import { parseArgs } from "node:util";

import { runLandingImports } from "../lib/import/runner.ts";

function printHelp() {
  console.log(`Usage: npm run etl:runner -- [options]

Options:
  --landing-root <path>   Local path or gs:// URI. Defaults to WAREHOUSE_LANDING_ROOT, WAREHOUSE_LANDING_URI, WAREHOUSE_LANDING_BUCKET, or ./landing-zone
  --gcs-bucket <name>     Use gs://<name> as the landing root
  --gcs-prefix <prefix>   Optional prefix under --gcs-bucket
  --max-files <count>     Maximum number of incoming files to process. Defaults to 1
  --source-system <name>  Only process files under incoming/<name>/
  --json                  Print the full run summary as JSON
  --help                  Show this help text

Landing contract:
  incoming/<source_system>/<YYYY>/<MM>/<DD>/<file>.csv
  incoming/.../<file>.csv.context.json

Context manifest fields:
  sourceAccountId
  accountName
  accountMask

Example:
  npm run etl:runner -- --landing-root ./landing-zone --max-files 5 --source-system discover
  npm run etl:runner -- --gcs-bucket finance-tracker-cdx-etl-landing --max-files 5
`);
}

function buildGcsLandingRoot(bucketName: string, prefix?: string) {
  const normalizedBucketName = bucketName.trim().replace(/^gs:\/\//, "").replace(/\/+$/, "");
  const normalizedPrefix = prefix?.trim().replace(/^\/+|\/+$/g, "");

  if (!normalizedBucketName) {
    throw new Error("--gcs-bucket must not be blank.");
  }

  return normalizedPrefix
    ? `gs://${normalizedBucketName}/${normalizedPrefix}`
    : `gs://${normalizedBucketName}`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      "landing-root": {
        type: "string",
      },
      "gcs-bucket": {
        type: "string",
      },
      "gcs-prefix": {
        type: "string",
      },
      "max-files": {
        type: "string",
      },
      "source-system": {
        type: "string",
      },
      json: {
        type: "boolean",
      },
      help: {
        type: "boolean",
      },
    },
  });

  if (values.help) {
    printHelp();
    return;
  }

  if (values["landing-root"] && values["gcs-bucket"]) {
    throw new Error("Use either --landing-root or --gcs-bucket, not both.");
  }

  const maxFiles = values["max-files"]
    ? Number.parseInt(values["max-files"], 10)
    : undefined;

  if (
    typeof maxFiles !== "undefined" &&
    (!Number.isInteger(maxFiles) || maxFiles < 1)
  ) {
    throw new Error("--max-files must be a positive integer.");
  }

  const landingRoot = values["gcs-bucket"]
    ? buildGcsLandingRoot(values["gcs-bucket"], values["gcs-prefix"])
    : values["landing-root"];

  const summary = await runLandingImports({
    landingRoot,
    maxFiles,
    sourceSystem: values["source-system"],
  });

  if (values.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else if (summary.processedCount === 0) {
    console.log(`No landed files found under ${summary.landingRoot}/incoming.`);
  } else {
    console.log(
      `Processed ${summary.processedCount} landed file(s) from ${summary.landingRoot} using ${summary.storageBackend} storage.`,
    );

    for (const result of summary.results) {
      if (result.status === "archived") {
        console.log(
          `ARCHIVED ${result.relativePath} -> batch ${result.importBatchId} (${result.rowCount} rows)`,
        );
      } else {
        console.log(
          `REJECTED ${result.relativePath} -> ${result.failureReason}: ${result.errorMessage}`,
        );
      }
    }
  }

  process.exitCode = summary.rejectedCount > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Landed import runner failed.",
  );
  process.exitCode = 1;
});
