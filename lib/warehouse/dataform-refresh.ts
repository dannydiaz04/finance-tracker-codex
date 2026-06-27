import "server-only";

import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import { isBigQueryConfigured } from "../bigquery/client.ts";

const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_LENGTH = 4_000;

let inFlightRefresh: Promise<WarehouseRefreshResult> | null = null;

export type WarehouseRefreshResult =
  | {
      status: "ran";
      durationMs: number;
      stdout: string;
      stderr: string;
      deduped?: boolean;
    }
  | {
      status: "skipped";
      reason: string;
    }
  | {
      status: "error";
      reason: string;
      durationMs: number;
      stdout?: string;
      stderr?: string;
      deduped?: boolean;
    };

function isDisabled(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();

  return (
    normalized === "0" ||
    normalized === "false" ||
    normalized === "no" ||
    normalized === "off"
  );
}

function readTimeoutMs() {
  const value = Number(process.env.WAREHOUSE_REFRESH_TIMEOUT_MS);

  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function truncateOutput(value: unknown) {
  if (!value) {
    return "";
  }

  const output = String(value);

  return output.length > MAX_OUTPUT_LENGTH
    ? `${output.slice(-MAX_OUTPUT_LENGTH)}`
    : output;
}

function publicSummary(result: WarehouseRefreshResult) {
  if (result.status === "ran") {
    return {
      status: result.status,
      durationMs: result.durationMs,
      deduped: result.deduped ?? false,
    };
  }

  if (result.status === "error") {
    return {
      status: result.status,
      reason: result.reason,
      durationMs: result.durationMs,
      deduped: result.deduped ?? false,
    };
  }

  return result;
}

async function runDataformRefresh(): Promise<WarehouseRefreshResult> {
  const startedAt = performance.now();

  try {
    const cliPath = requireFromHere.resolve("@dataform/cli/bundle.js");
    const args = [
      cliPath,
      "run",
      "dataform",
      "--action-retry-limit",
      "1",
    ];
    const credentialsFile = process.env.DATAFORM_CREDENTIALS_FILE?.trim();

    if (credentialsFile) {
      args.push("--credentials", credentialsFile);
    }

    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      timeout: readTimeoutMs(),
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      status: "ran",
      durationMs: Math.round(performance.now() - startedAt),
      stdout: truncateOutput(stdout),
      stderr: truncateOutput(stderr),
    };
  } catch (error) {
    const cause = error as {
      message?: string;
      stdout?: unknown;
      stderr?: unknown;
    };

    return {
      status: "error",
      reason: cause.message ?? "Dataform warehouse refresh failed.",
      durationMs: Math.round(performance.now() - startedAt),
      stdout: truncateOutput(cause.stdout),
      stderr: truncateOutput(cause.stderr),
    };
  }
}

export function summarizeWarehouseRefresh(result: WarehouseRefreshResult) {
  return publicSummary(result);
}

export async function refreshWarehouseMarts(): Promise<WarehouseRefreshResult> {
  if (isDisabled(process.env.PLAID_SYNC_REFRESH_WAREHOUSE)) {
    return {
      status: "skipped",
      reason: "Warehouse refresh is disabled by PLAID_SYNC_REFRESH_WAREHOUSE.",
    };
  }

  if (!isBigQueryConfigured()) {
    return {
      status: "skipped",
      reason: "BigQuery is not configured.",
    };
  }

  if (inFlightRefresh) {
    const result = await inFlightRefresh;

    return result.status === "skipped"
      ? result
      : { ...result, deduped: true };
  }

  inFlightRefresh = runDataformRefresh().finally(() => {
    inFlightRefresh = null;
  });

  return inFlightRefresh;
}
