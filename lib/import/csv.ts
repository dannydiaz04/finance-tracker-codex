import Papa from "papaparse";

import { insertBigQueryRows, isBigQueryConfigured } from "@/lib/bigquery/client";
import { inferCsvColumnMapping } from "@/lib/import/mapping";
import {
  normalizeCsvRow,
  type CsvRow,
  type NormalizedImportEvent,
} from "@/lib/import/normalize";
import type { ImportBatch, TransactionEvent } from "@/lib/types/finance";

export type ParsedCsvImport = {
  importBatch: ImportBatch;
  events: TransactionEvent[];
  normalizedRows: NormalizedImportEvent[];
};

export function parseCsvImport(csv: string, fileName = "manual-upload.csv") {
  const parsed = Papa.parse<CsvRow>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors.map((error: Papa.ParseError) => error.message).join(", "),
    );
  }

  const headers = parsed.meta.fields ?? [];
  const mapping = inferCsvColumnMapping(headers);
  const importBatchId = `batch-${Date.now()}`;
  const normalizedRows = parsed.data.map((row: CsvRow, index: number) =>
    normalizeCsvRow(row, mapping, index),
  );

  const events: TransactionEvent[] = normalizedRows.map(
    (row: NormalizedImportEvent, index: number) => ({
    eventId: `${importBatchId}-event-${index + 1}`,
    importBatchId,
    sourceName: "csv",
    sourceTransactionId: row.sourceTransactionId,
    sourceAccountId: row.sourceAccountId,
    eventType: "added",
    eventTimestamp: new Date().toISOString(),
    payload: row,
    }),
  );

  return {
    importBatch: {
      importBatchId,
      sourceName: "csv",
      importedAt: new Date().toISOString(),
      rowCount: normalizedRows.length,
      status: "parsed",
      fileName,
    },
    events,
    normalizedRows,
  } satisfies ParsedCsvImport;
}

export async function persistCsvImport(parsedImport: ParsedCsvImport) {
  if (!isBigQueryConfigured()) {
    return {
      persisted: false,
      reason: "BigQuery is not configured. Parsed import returned as preview only.",
    };
  }

  await insertBigQueryRows("raw_finance", "import_batches", [
    parsedImport.importBatch as unknown as Record<string, unknown>,
  ]);
  await insertBigQueryRows(
    "raw_finance",
    "transaction_events",
    parsedImport.events as unknown as Record<string, unknown>[],
  );

  return {
    persisted: true,
    reason: "Rows inserted into raw_finance datasets.",
  };
}
