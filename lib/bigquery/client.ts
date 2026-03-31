import "server-only";

import { BigQuery, type BigQueryOptions } from "@google-cloud/bigquery";

let bigQueryClient: BigQuery | null | undefined;

export function getBigQueryClient() {
  if (typeof bigQueryClient !== "undefined") {
    return bigQueryClient;
  }

  const projectId =
    process.env.BIGQUERY_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    bigQueryClient = null;
    return bigQueryClient;
  }

  const options: BigQueryOptions = {
    projectId,
    location: process.env.BIGQUERY_LOCATION ?? "US",
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
    location: process.env.BIGQUERY_LOCATION ?? "US",
  });

  return rows as T[];
}

export async function insertBigQueryRows(
  datasetId: string,
  tableId: string,
  rows: Record<string, unknown>[],
) {
  const client = getBigQueryClient();

  if (!client || rows.length === 0) {
    return false;
  }

  await client.dataset(datasetId).table(tableId).insert(rows);
  return true;
}
