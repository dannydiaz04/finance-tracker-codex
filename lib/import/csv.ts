import Papa from "papaparse";

import { insertBigQueryRows, isBigQueryConfigured } from "../bigquery/client.ts";
import {
  normalizeCsvRow,
  normalizeProfileCsvRow,
  type CsvRow,
  type NormalizedImportEvent,
} from "./normalize.ts";
import {
  inferCsvColumnMapping,
  isHeaderlessCsvProfile,
  resolveCsvSourceProfile,
  type CsvImportRuntimeAccountContext,
  type CsvSourceMappingProfile,
} from "./mapping.ts";
import {
  toRawImportBatchInsertRow,
  toRawTransactionEventInsertRows,
} from "./persistence.ts";
import type { ImportBatch, TransactionEvent } from "../types/finance.ts";

export type ParseCsvImportOptions = {
  fileName?: string;
  runtimeAccountContext?: Partial<CsvImportRuntimeAccountContext>;
};

export type ParsedCsvImport = {
  importBatch: ImportBatch;
  events: TransactionEvent[];
  normalizedRows: NormalizedImportEvent[];
  mappingResolution: ParsedCsvImportMappingResolution;
};

export type ParsedCsvImportMappingResolution =
  | {
      strategy: "profile";
      profileId: string;
      matchedBy: string[];
      runtimeAccountContext: Partial<CsvImportRuntimeAccountContext>;
    }
  | {
      strategy: "inferred";
      runtimeAccountContext: Partial<CsvImportRuntimeAccountContext>;
    };

function sanitizeCell(value: string | undefined) {
  return (value ?? "").replace(/^\uFEFF/, "").trim();
}

function parseCsvMatrix(csv: string) {
  const parsed = Papa.parse<string[]>(csv, {
    header: false,
    skipEmptyLines: true,
    transform: (value: string) => value.trim(),
  });

  if (parsed.errors.length > 0) {
    throw new Error(
      parsed.errors.map((error: Papa.ParseError) => error.message).join(", "),
    );
  }

  return parsed.data.map((row) => row.map((value) => sanitizeCell(value)));
}

function buildHeaderedRows(matrix: string[][]) {
  const headers = (matrix[0] ?? []).map((header) => sanitizeCell(header));
  const rows = matrix.slice(1).map((values) =>
    headers.reduce<CsvRow>((row, header, index) => {
      row[header] = sanitizeCell(values[index]);
      return row;
    }, {}),
  );

  return {
    headers,
    rows,
  };
}

function buildHeaderlessRows(
  matrix: string[][],
  profile: CsvSourceMappingProfile,
) {
  const labeledColumns = Object.values(profile.field_map).filter(
    (entry) =>
      typeof entry.source_index === "number" &&
      typeof entry.source_label === "string",
  );

  return matrix.map((values) => {
    const row: CsvRow = {};

    values.forEach((value, index) => {
      row[`column_${index + 1}`] = sanitizeCell(value);
    });

    labeledColumns.forEach((entry) => {
      row[entry.source_label as string] =
        row[`column_${entry.source_index}`] ?? "";
    });

    return row;
  });
}

export function parseCsvImport(
  csv: string,
  optionsOrFileName: string | ParseCsvImportOptions = "manual-upload.csv",
) {
  const options =
    typeof optionsOrFileName === "string"
      ? { fileName: optionsOrFileName }
      : optionsOrFileName;
  const fileName = options.fileName ?? "manual-upload.csv";
  const runtimeAccountContext = options.runtimeAccountContext ?? {};
  const matrix = parseCsvMatrix(csv);

  if (matrix.length === 0) {
    throw new Error("CSV payload was empty.");
  }

  const resolvedProfile = resolveCsvSourceProfile({
    fileName,
    firstRow: matrix[0] ?? [],
  });
  const importBatchId = `batch-${Date.now()}`;
  const normalizedRows = resolvedProfile
    ? isHeaderlessCsvProfile(resolvedProfile.profile)
      ? buildHeaderlessRows(matrix, resolvedProfile.profile).map((row, index) =>
          normalizeProfileCsvRow(
            row,
            resolvedProfile.profile,
            index,
            runtimeAccountContext,
          ),
        )
      : (() => {
          const { rows } = buildHeaderedRows(matrix);

          return rows.map((row, index) =>
            normalizeProfileCsvRow(
              row,
              resolvedProfile.profile,
              index,
              runtimeAccountContext,
            ),
          );
        })()
    : (() => {
        const { headers, rows } = buildHeaderedRows(matrix);
        const mapping = inferCsvColumnMapping(headers);

        return rows.map((row, index) =>
          normalizeCsvRow(row, mapping, index, runtimeAccountContext),
        );
      })();

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
    mappingResolution: resolvedProfile
      ? {
          strategy: "profile",
          profileId: resolvedProfile.profile.id,
          matchedBy: resolvedProfile.matchedBy,
          runtimeAccountContext,
        }
      : {
          strategy: "inferred",
          runtimeAccountContext,
        },
  } satisfies ParsedCsvImport;
}

export async function persistCsvImport(parsedImport: ParsedCsvImport) {
  if (!isBigQueryConfigured()) {
    return {
      persisted: false,
      reason: "BigQuery is not configured. Parsed import returned as preview only.",
    };
  }

  const importBatchRow: Record<string, unknown> =
    toRawImportBatchInsertRow(parsedImport);
  const transactionEventRows: Record<string, unknown>[] =
    toRawTransactionEventInsertRows(parsedImport);

  await insertBigQueryRows(
    "raw_finance",
    "import_batches",
    [importBatchRow],
  );
  await insertBigQueryRows(
    "raw_finance",
    "transaction_events",
    transactionEventRows,
  );

  return {
    persisted: true,
    reason: "Rows inserted into raw_finance datasets.",
  };
}
