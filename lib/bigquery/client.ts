import "server-only";

import {
  BigQuery,
  type BigQueryOptions,
  type InsertRowsOptions,
} from "@google-cloud/bigquery";

let bigQueryClient: BigQuery | null | undefined;

function readEnvValue(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return null;
}

export function getBigQueryProjectId() {
  return readEnvValue("BIGQUERY_PROJECT_ID", "GOOGLE_CLOUD_PROJECT");
}

export function getBigQueryLocation() {
  return readEnvValue("BIGQUERY_LOCATION") ?? "US";
}

export function getBigQueryStatus() {
  const projectId = getBigQueryProjectId();

  return {
    configured: Boolean(projectId),
    projectId,
    location: getBigQueryLocation(),
    reason: projectId
      ? null
      : "BIGQUERY_PROJECT_ID or GOOGLE_CLOUD_PROJECT is missing or blank.",
  };
}

export function getBigQueryClient() {
  if (typeof bigQueryClient !== "undefined") {
    return bigQueryClient;
  }

  const projectId = getBigQueryProjectId();

  if (!projectId) {
    bigQueryClient = null;
    return bigQueryClient;
  }

  const options: BigQueryOptions = {
    projectId,
    location: getBigQueryLocation(),
  };

  bigQueryClient = new BigQuery(options);
  return bigQueryClient;
}

export function isBigQueryConfigured() {
  return Boolean(getBigQueryClient());
}

export async function runBigQueryQuery<T>(
  query: string,
  params?: Record<string, unknown>,
) {
  const client = getBigQueryClient();

  if (!client) {
    return null;
  }

  const [rows] = await client.query({
    query,
    params,
    useLegacySql: false,
    location: getBigQueryLocation(),
  });

  return rows as T[];
}

export async function insertBigQueryRows(
  datasetId: string,
  tableId: string,
  rows: Record<string, unknown>[],
  options?: InsertRowsOptions,
) {
  const client = getBigQueryClient();

  if (!client || rows.length === 0) {
    return false;
  }

  await client.dataset(datasetId).table(tableId).insert(rows, options);
  return true;
}
