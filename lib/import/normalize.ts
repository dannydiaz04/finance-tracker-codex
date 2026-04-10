import { createHash } from "node:crypto";

import { isValid, parse as parseDate } from "date-fns";

import { buildNormalizedTransaction } from "../categorization/normalize.ts";
import { classifyMovementType } from "../categorization/rules.ts";
import type { TransactionDirection } from "../types/finance.ts";
import type {
  CsvColumnMapping,
  CsvDerivedField,
  CsvImportRuntimeAccountContext,
  CsvSourceFieldMapEntry,
  CsvSourceMappingProfile,
} from "./mapping.ts";

export type CsvRow = Record<string, string>;

export type NormalizedImportEvent = {
  sourceTransactionId: string;
  sourceAccountId: string;
  accountName: string;
  postedAt: string;
  authorizedAt: string | null;
  descriptionRaw: string;
  merchantRaw: string;
  institutionCategory: string | null;
  pending: boolean;
  signedAmount: number;
  direction: TransactionDirection;
  transactionClass: ReturnType<typeof classifyMovementType>;
  rawPayloadJson: Record<string, unknown>;
  merchantNorm: string;
  descriptionNorm: string;
  keywordArray: string[];
} & Record<string, unknown>;

const coreNormalizedFieldNames = new Set([
  "sourceTransactionId",
  "sourceAccountId",
  "accountName",
  "postedAt",
  "authorizedAt",
  "descriptionRaw",
  "merchantRaw",
  "institutionCategory",
  "pending",
  "signedAmount",
  "direction",
  "transactionClass",
  "rawPayloadJson",
  "merchantNorm",
  "descriptionNorm",
  "keywordArray",
]);

function normalizeRawString(value: unknown) {
  if (value === null || typeof value === "undefined") {
    return "";
  }

  return String(value).replace(/^\uFEFF/, "").trim();
}

function isBlankValue(value: unknown) {
  return normalizeRawString(value).length === 0;
}

function toSnakeCase(value: string) {
  return normalizeRawString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function toDateFnsFormat(format: string) {
  return format
    .replaceAll("YYYY", "yyyy")
    .replaceAll("YY", "yy")
    .replaceAll("DD", "dd")
    .replaceAll("D", "d");
}

function parseSupportedDate(value: string, parseAs?: string) {
  const normalizedValue = normalizeRawString(value);
  const parsed = parseAs
    ? parseDate(normalizedValue, toDateFnsFormat(parseAs), new Date())
    : new Date(normalizedValue);

  if (!isValid(parsed)) {
    throw new Error(`Invalid date value: ${value}`);
  }

  return new Date(
    Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
  );
}

function formatUtcDate(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function normalizeDate(value: string, parseAs?: string) {
  return formatUtcDate(parseSupportedDate(value, parseAs));
}

function normalizeTimestamp(value: string, parseAs?: string) {
  return parseSupportedDate(value, parseAs).toISOString();
}

function normalizeAmount(value: unknown) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid amount value: ${value}`);
    }

    return value;
  }

  const normalizedValue = normalizeRawString(value);
  const isWrappedNegative =
    normalizedValue.startsWith("(") && normalizedValue.endsWith(")");
  const parsed = Number(
    normalizedValue
      .replace(/[$,]/g, "")
      .replace(/[()]/g, "")
      .trim(),
  );

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid amount value: ${value}`);
  }

  return isWrappedNegative ? -Math.abs(parsed) : parsed;
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  if (isBlankValue(value)) {
    return false;
  }

  return ["true", "yes", "1", "pending"].includes(
    normalizeRawString(value).toLowerCase(),
  );
}

function normalizeSignLabel(value: string) {
  return normalizeRawString(value).toLowerCase();
}

function trimWrappingQuotes(value: string) {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }

  return value;
}

function resolveRowValue(row: CsvRow, entry: CsvSourceFieldMapEntry) {
  if (typeof entry.source_index === "number") {
    const genericColumnKey = `column_${entry.source_index}`;

    return (
      row[entry.source_label ?? ""] ??
      row[genericColumnKey] ??
      ""
    );
  }

  if (entry.source) {
    return row[entry.source] ?? "";
  }

  return "";
}

function applyFieldTransform(
  row: CsvRow,
  entry: CsvSourceFieldMapEntry,
  value: unknown,
) {
  const transform = entry.transform;

  if (transform?.true_when_blank) {
    return isBlankValue(row[transform.true_when_blank]);
  }

  if (value === null || typeof value === "undefined") {
    return value;
  }

  let transformedValue = value;

  if (transform?.trim_wrapping_quotes) {
    transformedValue = trimWrappingQuotes(normalizeRawString(transformedValue));
  }

  if (transform?.template) {
    transformedValue = transform.template.replaceAll(
      /\{([^}]+)\}/g,
      (_, key: string) => normalizeRawString(row[key] ?? transformedValue),
    );
  }

  if (typeof transform?.take_last === "number") {
    transformedValue = normalizeRawString(transformedValue).slice(
      -transform.take_last,
    );
  }

  if (transform?.parse_as) {
    return transform.coerce_to === "timestamp"
      ? normalizeTimestamp(normalizeRawString(transformedValue), transform.parse_as)
      : normalizeDate(normalizeRawString(transformedValue), transform.parse_as);
  }

  if (
    transform?.absolute_value ||
    transform?.invert_source_sign ||
    transform?.use_source_sign ||
    transform?.sign_from
  ) {
    let numericValue = normalizeAmount(transformedValue);

    if (transform.absolute_value) {
      numericValue = Math.abs(numericValue);
    }

    if (transform.invert_source_sign) {
      numericValue *= -1;
    }

    if (transform.sign_from) {
      const signField = normalizeSignLabel(row[transform.sign_from.field] ?? "");
      const positiveValues = new Set(
        (transform.sign_from.positive_values ?? []).map(normalizeSignLabel),
      );
      const negativeValues = new Set(
        (transform.sign_from.negative_values ?? []).map(normalizeSignLabel),
      );

      if (positiveValues.has(signField)) {
        numericValue = Math.abs(numericValue);
      } else if (negativeValues.has(signField)) {
        numericValue = -Math.abs(numericValue);
      }
    }

    return numericValue;
  }

  return transformedValue;
}

function resolveMappedFieldValue(
  row: CsvRow,
  entry: CsvSourceFieldMapEntry,
  runtimeAccountContext: Partial<CsvImportRuntimeAccountContext>,
) {
  let value: unknown;

  if (entry.from_runtime_context) {
    value = runtimeAccountContext[entry.from_runtime_context];
  }

  if (isBlankValue(value) && (entry.source || typeof entry.source_index === "number")) {
    value = resolveRowValue(row, entry);
  }

  if (isBlankValue(value) && entry.fallback_source) {
    value = row[entry.fallback_source] ?? "";
  }

  if (isBlankValue(value) && Object.hasOwn(entry, "default")) {
    value = entry.default;
  }

  if (isBlankValue(value) && Object.hasOwn(entry, "fallback_default")) {
    value = entry.fallback_default;
  }

  return applyFieldTransform(row, entry, value);
}

function findMappedSourceValue(
  profile: CsvSourceMappingProfile,
  canonicalValues: Record<string, unknown>,
  sourceField: string,
) {
  if (Object.hasOwn(canonicalValues, sourceField)) {
    return canonicalValues[sourceField];
  }

  for (const [targetField, entry] of Object.entries(profile.field_map)) {
    if (
      entry.source === sourceField ||
      entry.source_label === sourceField ||
      `column_${entry.source_index}` === sourceField
    ) {
      return canonicalValues[targetField];
    }
  }

  return undefined;
}

function buildSourceTransactionIdHash(
  profile: CsvSourceMappingProfile,
  fields: string[],
  row: CsvRow,
  canonicalValues: Record<string, unknown>,
) {
  const hashInput = fields
    .map((field) => {
      const canonicalValue = findMappedSourceValue(
        profile,
        canonicalValues,
        field,
      );
      return canonicalValue ?? row[field] ?? "";
    })
    .map((value) => normalizeRawString(value))
    .join("\u001f");

  return `${profile.id}:${createHash("sha256").update(hashInput).digest("hex")}`;
}

function deriveSourceTransactionId(
  profile: CsvSourceMappingProfile,
  row: CsvRow,
  canonicalValues: Record<string, unknown>,
) {
  const configuredSourceTransactionId = profile.derived?.sourceTransactionId;

  if (!configuredSourceTransactionId) {
    return undefined;
  }

  if (
    configuredSourceTransactionId.strategy === "prefer_field" &&
    typeof configuredSourceTransactionId.field === "string"
  ) {
    const preferredValue =
      findMappedSourceValue(
        profile,
        canonicalValues,
        configuredSourceTransactionId.field,
      ) ?? row[configuredSourceTransactionId.field];

    if (!isBlankValue(preferredValue)) {
      return normalizeRawString(preferredValue);
    }

    const fallback = configuredSourceTransactionId.fallback as
      | CsvDerivedField
      | undefined;

    if (fallback?.strategy === "hash" && Array.isArray(fallback.fields)) {
      return buildSourceTransactionIdHash(
        profile,
        fallback.fields.map((field) => String(field)),
        row,
        canonicalValues,
      );
    }
  }

  if (
    configuredSourceTransactionId.strategy === "hash" &&
    Array.isArray(configuredSourceTransactionId.fields)
  ) {
    return buildSourceTransactionIdHash(
      profile,
      configuredSourceTransactionId.fields.map((field) => String(field)),
      row,
      canonicalValues,
    );
  }

  return undefined;
}

function finalizeNormalizedEvent(
  canonicalValues: Record<string, unknown>,
  row: CsvRow,
  index: number,
) {
  const descriptionRaw = normalizeRawString(
    canonicalValues.descriptionRaw ?? canonicalValues.merchantRaw,
  );
  const merchantRaw =
    normalizeRawString(canonicalValues.merchantRaw) || descriptionRaw;
  const accountName =
    normalizeRawString(canonicalValues.accountName) || "Imported Account";
  const sourceAccountId =
    normalizeRawString(canonicalValues.sourceAccountId) || toSnakeCase(accountName);
  const postedAtValue = canonicalValues.postedAt;
  const postedAt =
    typeof postedAtValue === "string" && /^\d{4}-\d{2}-\d{2}$/.test(postedAtValue)
      ? postedAtValue
      : normalizeDate(normalizeRawString(postedAtValue));
  const authorizedAtValue = canonicalValues.authorizedAt;
  const authorizedAt =
    authorizedAtValue === null || isBlankValue(authorizedAtValue)
      ? null
      : typeof authorizedAtValue === "string" &&
          /^\d{4}-\d{2}-\d{2}T/.test(authorizedAtValue)
        ? authorizedAtValue
        : normalizeTimestamp(normalizeRawString(authorizedAtValue));
  const signedAmount = normalizeAmount(canonicalValues.signedAmount);
  const institutionCategory = isBlankValue(canonicalValues.institutionCategory)
    ? null
    : normalizeRawString(canonicalValues.institutionCategory);
  const pending = normalizeBoolean(canonicalValues.pending);
  const normalized = buildNormalizedTransaction({
    merchantRaw,
    descriptionRaw,
  });
  const rawPayloadJson =
    canonicalValues.rawPayloadJson &&
    typeof canonicalValues.rawPayloadJson === "object" &&
    !Array.isArray(canonicalValues.rawPayloadJson)
      ? (canonicalValues.rawPayloadJson as Record<string, unknown>)
      : row;
  const extraFields = Object.fromEntries(
    Object.entries(canonicalValues).filter(
      ([field, value]) =>
        !coreNormalizedFieldNames.has(field) && typeof value !== "undefined",
    ),
  );

  return {
    sourceTransactionId:
      normalizeRawString(canonicalValues.sourceTransactionId) ||
      `csv-${postedAt}-${index + 1}`,
    sourceAccountId,
    accountName,
    postedAt,
    authorizedAt,
    descriptionRaw,
    merchantRaw,
    institutionCategory,
    pending,
    signedAmount,
    direction: signedAmount >= 0 ? "inflow" : "outflow",
    transactionClass: classifyMovementType(signedAmount, descriptionRaw),
    rawPayloadJson,
    merchantNorm: normalized.merchantNorm,
    descriptionNorm: normalized.descriptionNorm,
    keywordArray: normalized.keywordArray,
    ...extraFields,
  } as NormalizedImportEvent;
}

export function normalizeCsvRow(
  row: CsvRow,
  mapping: CsvColumnMapping,
  index: number,
  runtimeAccountContext: Partial<CsvImportRuntimeAccountContext> = {},
) {
  const accountName =
    row[mapping.accountName ?? ""] || runtimeAccountContext.accountName;

  return finalizeNormalizedEvent(
    {
      sourceAccountId:
        row[mapping.accountId ?? ""] || runtimeAccountContext.sourceAccountId,
      accountName,
      accountMask: runtimeAccountContext.accountMask,
      postedAt: row[mapping.postedAt] ?? "",
      authorizedAt: null,
      descriptionRaw: row[mapping.description] ?? "",
      merchantRaw: row[mapping.merchant ?? mapping.description] ?? "",
      institutionCategory: mapping.institutionCategory
        ? row[mapping.institutionCategory] || null
        : null,
      pending: mapping.pending ? row[mapping.pending] : false,
      signedAmount: row[mapping.amount] ?? "",
      rawPayloadJson: row,
    },
    row,
    index,
  );
}

export function normalizeProfileCsvRow(
  row: CsvRow,
  profile: CsvSourceMappingProfile,
  index: number,
  runtimeAccountContext: Partial<CsvImportRuntimeAccountContext> = {},
) {
  const canonicalValues: Record<string, unknown> = {};

  for (const [targetField, entry] of Object.entries(profile.field_map)) {
    canonicalValues[targetField] = resolveMappedFieldValue(
      row,
      entry,
      runtimeAccountContext,
    );
  }

  for (const [field, value] of Object.entries(profile.defaults ?? {})) {
    if (typeof canonicalValues[field] === "undefined") {
      canonicalValues[field] = value;
    }
  }

  if (isBlankValue(canonicalValues.sourceAccountId)) {
    canonicalValues.sourceAccountId = runtimeAccountContext.sourceAccountId;
  }

  if (isBlankValue(canonicalValues.accountName)) {
    canonicalValues.accountName = runtimeAccountContext.accountName;
  }

  if (isBlankValue(canonicalValues.accountMask)) {
    canonicalValues.accountMask = runtimeAccountContext.accountMask;
  }

  canonicalValues.rawPayloadJson = row;
  canonicalValues.sourceTransactionId =
    canonicalValues.sourceTransactionId ??
    deriveSourceTransactionId(profile, row, canonicalValues);

  return finalizeNormalizedEvent(canonicalValues, row, index);
}
