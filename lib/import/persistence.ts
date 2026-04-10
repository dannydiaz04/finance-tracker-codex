import type { ParsedCsvImport } from "./csv.ts";

export type RawImportBatchInsertRow = {
  import_batch_id: string;
  source_name: string;
  imported_at: string;
  row_count: number;
  status: string;
  file_name: string;
  mapping_profile_id: string | null;
  mapping_resolution_strategy: string;
  mapping_matched_by: string[];
  runtime_source_account_id: string | null;
  runtime_account_name: string | null;
  runtime_account_mask: string | null;
};

export type RawTransactionEventInsertRow = {
  event_id: string;
  import_batch_id: string;
  source_name: string;
  source_transaction_id: string;
  source_account_id: string;
  event_type: string;
  event_timestamp: string;
  payload: string;
};

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim();
  return normalizedValue.length > 0 ? normalizedValue : null;
}

function getMatchedBy(parsedImport: ParsedCsvImport) {
  return parsedImport.mappingResolution.strategy === "profile"
    ? parsedImport.mappingResolution.matchedBy
    : ["fallback-header-inference"];
}

export function toRawImportBatchInsertRow(
  parsedImport: ParsedCsvImport,
): RawImportBatchInsertRow {
  const runtimeAccountContext = parsedImport.mappingResolution.runtimeAccountContext;

  return {
    import_batch_id: parsedImport.importBatch.importBatchId,
    source_name: parsedImport.importBatch.sourceName,
    imported_at: parsedImport.importBatch.importedAt,
    row_count: parsedImport.importBatch.rowCount,
    status: parsedImport.importBatch.status,
    file_name: parsedImport.importBatch.fileName,
    mapping_profile_id:
      parsedImport.mappingResolution.strategy === "profile"
        ? parsedImport.mappingResolution.profileId
        : null,
    mapping_resolution_strategy: parsedImport.mappingResolution.strategy,
    mapping_matched_by: getMatchedBy(parsedImport),
    runtime_source_account_id: normalizeOptionalString(
      runtimeAccountContext.sourceAccountId,
    ),
    runtime_account_name: normalizeOptionalString(runtimeAccountContext.accountName),
    runtime_account_mask: normalizeOptionalString(runtimeAccountContext.accountMask),
  };
}

export function toRawTransactionEventInsertRows(
  parsedImport: ParsedCsvImport,
): RawTransactionEventInsertRow[] {
  return parsedImport.events.map((event) => ({
    event_id: event.eventId,
    import_batch_id: event.importBatchId,
    source_name: event.sourceName,
    source_transaction_id: event.sourceTransactionId,
    source_account_id: event.sourceAccountId,
    event_type: event.eventType,
    event_timestamp: event.eventTimestamp,
    payload: JSON.stringify(event.payload),
  }));
}
