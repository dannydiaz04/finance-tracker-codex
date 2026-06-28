import { parseArgs } from "node:util";
import { join } from "node:path";

import nextEnv from "@next/env";

import { SecureBrowserSession } from "./lib/browser-session.ts";
import { loadPortalCredentials, validateChunkDates } from "./lib/credentials.ts";
import { buildTargetFilename } from "./lib/downloads.ts";
import { createSafeLogger } from "./lib/logging.ts";
import { getPortalAdapter, listPortals, parsePortalId } from "./portals/registry.ts";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

function printHelp() {
  console.log(`Usage: npm run backfill:export -- --portal <id> --start <YYYY-MM-DD> --end <YYYY-MM-DD> [options]

Secure headless-browser CSV export for finance-tracker-codex dropbox ingestion.

Required:
  --portal <id>           Portal id (apple_card, capital_one, chase, discover, american_express, micro_center)
  --start <YYYY-MM-DD>    Export range start (inclusive)
  --end <YYYY-MM-DD>      Export range end (inclusive)

Options:
  --headed                Run with a visible browser (required for MFA)
  --use-session           Reuse ~/.finance-tracker/sessions/<portal>.json if present
  --save-session          Persist session cookies after a successful run (mode 0600)
  --dropbox-dir <path>    Download directory (default: ./dropbox)
  --dry-run               Validate args and credentials without launching a browser
  --list-portals          Print configured portals and exit
  --help                  Show this help text

Examples:
  npm run backfill:export -- --portal apple_card --start 2023-06-28 --end 2024-06-27 --headed
  npm run backfill:export -- --portal chase --start 2023-06-28 --end 2024-06-27 --use-session --save-session
  npm run backfill:export -- --portal capital_one --start 2025-06-28 --end 2026-03-15 --dry-run

After a successful export:
  npm run etl:dropbox -- --dry-run
  npm run etl:dropbox
`);
}

function printPortals() {
  for (const adapter of listPortals()) {
    const { definition } = adapter;
    console.log(
      `${definition.id.padEnd(18)} ${definition.label.padEnd(28)} prefix=${definition.filePrefix}`,
    );
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      portal: { type: "string" },
      start: { type: "string" },
      end: { type: "string" },
      headed: { type: "boolean" },
      "use-session": { type: "boolean" },
      "save-session": { type: "boolean" },
      "dropbox-dir": { type: "string" },
      "dry-run": { type: "boolean" },
      "list-portals": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });

  if (values.help) {
    printHelp();
    return;
  }

  if (values["list-portals"]) {
    printPortals();
    return;
  }

  if (!values.portal || !values.start || !values.end) {
    printHelp();
    process.exitCode = 1;
    return;
  }

  const portalId = parsePortalId(values.portal);
  const adapter = getPortalAdapter(portalId);
  const chunk = { startDate: values.start, endDate: values.end };
  const dropboxDir = values["dropbox-dir"] ?? join(process.cwd(), "dropbox");
  const log = createSafeLogger("cli");

  validateChunkDates(chunk.startDate, chunk.endDate);

  const targetFilename = buildTargetFilename(adapter.definition.filePrefix, chunk);

  if (values["dry-run"]) {
    try {
      loadPortalCredentials(adapter.definition);
      log.info("Credentials: present");
    } catch {
      log.warn(
        `Credentials missing — set ${adapter.definition.credentialEnvKeys.user} and ${adapter.definition.credentialEnvKeys.pass} in .env.local before a real run`,
      );
    }

    log.info(`Dry run OK — would export ${adapter.definition.label}`);
    log.info(`Target file: ${join(dropboxDir, targetFilename)}`);
    log.info(`Headless: ${values.headed ? "no (--headed)" : "yes"}`);
    return;
  }

  loadPortalCredentials(adapter.definition);

  const session = new SecureBrowserSession(adapter);

  try {
    const outputPath = await session.runExport(chunk, {
      headless: !values.headed,
      dropboxDir,
      useSavedSession: Boolean(values["use-session"]),
      saveSession: Boolean(values["save-session"]),
    });

    log.info(`Export complete: ${outputPath}`);
    log.info("Next: npm run etl:dropbox -- --dry-run && npm run etl:dropbox");
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
