import "server-only";

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { load as loadYaml } from "js-yaml";

export type CsvColumnMapping = {
  postedAt: string;
  description: string;
  amount: string;
  merchant?: string;
  accountName?: string;
  accountId?: string;
  institutionCategory?: string;
  pending?: string;
};

export type CsvImportRuntimeAccountContext = {
  sourceAccountId: string;
  accountName: string;
  accountMask?: string;
};

export type CsvSourceFieldTransform = {
  parse_as?: string;
  coerce_to?: "timestamp";
  absolute_value?: boolean;
  invert_source_sign?: boolean;
  use_source_sign?: boolean;
  sign_from?: {
    field: string;
    positive_values?: string[];
    negative_values?: string[];
    fallback?: "use_source_sign";
  };
  true_when_blank?: string;
  template?: string;
  take_last?: number;
  trim_wrapping_quotes?: boolean;
};

export type CsvSourceFieldMapEntry = {
  source?: string;
  fallback_source?: string;
  source_index?: number;
  source_label?: string;
  from_runtime_context?: keyof CsvImportRuntimeAccountContext;
  default?: unknown;
  fallback_default?: unknown;
  transform?: CsvSourceFieldTransform;
};

export type CsvDerivedField = {
  strategy: string;
  [key: string]: unknown;
};

export type CsvSourceMappingProfile = {
  id: string;
  source_system: string;
  feed: string;
  format: string;
  file_match?: {
    filename_contains?: string[];
    required_headers?: string[];
    header_row?: "absent";
    expected_nonempty_columns?: Record<string, string>;
  };
  field_map: Record<string, CsvSourceFieldMapEntry>;
  defaults?: Record<string, unknown>;
  derived?: Record<string, CsvDerivedField | undefined>;
  notes?: string[];
};

export type CsvMappingMatchMode =
  | "filename"
  | "header-signature"
  | "column-shape";

export type ResolvedCsvSourceProfile = {
  profile: CsvSourceMappingProfile;
  matchedBy: CsvMappingMatchMode[];
};

const SOURCE_MAPPINGS_DIRECTORY = join(process.cwd(), "source-mappings");

const candidateColumns: Record<keyof CsvColumnMapping, string[]> = {
  postedAt: ["date", "posted_at", "posted date", "transaction date"],
  description: ["description", "memo", "details", "narrative"],
  amount: ["amount", "signed_amount", "transaction amount"],
  merchant: ["merchant", "payee", "name"],
  accountName: ["account", "account_name"],
  accountId: ["account_id", "accountid"],
  institutionCategory: ["category", "institution_category"],
  pending: ["pending", "is_pending"],
};

function normalizeMatcherValue(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase();
}

function matchColumn(headers: string[], aliases: string[]) {
  const normalizedHeaders = headers.map((header) => normalizeMatcherValue(header));
  const index = normalizedHeaders.findIndex((header) => aliases.includes(header));

  if (index === -1) {
    return undefined;
  }

  return headers[index];
}

function isCsvSourceMappingProfile(value: unknown): value is CsvSourceMappingProfile {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<CsvSourceMappingProfile>;
  return Boolean(
    candidate.id &&
      candidate.source_system &&
      candidate.feed &&
      candidate.format === "csv" &&
      candidate.field_map &&
      typeof candidate.field_map === "object",
  );
}

function matchesFileName(fileName: string, filenameContains: string[] = []) {
  if (filenameContains.length === 0) {
    return false;
  }

  const normalizedFileName = normalizeMatcherValue(fileName);
  return filenameContains.every((candidate) =>
    normalizedFileName.includes(normalizeMatcherValue(candidate)),
  );
}

function matchesRequiredHeaders(firstRow: string[], requiredHeaders: string[] = []) {
  if (requiredHeaders.length === 0) {
    return false;
  }

  const normalizedHeaders = new Set(firstRow.map((header) => normalizeMatcherValue(header)));
  return requiredHeaders.every((header) =>
    normalizedHeaders.has(normalizeMatcherValue(header)),
  );
}

function matchesColumnShape(
  firstRow: string[],
  expectedNonemptyColumns: Record<string, string> = {},
) {
  const columnIndexes = Object.keys(expectedNonemptyColumns);

  if (columnIndexes.length === 0) {
    return false;
  }

  return columnIndexes.every((columnIndexText) => {
    const columnIndex = Number(columnIndexText);

    if (!Number.isInteger(columnIndex) || columnIndex < 1) {
      return false;
    }

    return normalizeMatcherValue(firstRow[columnIndex - 1] ?? "").length > 0;
  });
}

function getSpecificity(match: ResolvedCsvSourceProfile) {
  const fileMatch = match.profile.file_match;

  return [
    match.matchedBy.length,
    fileMatch?.required_headers?.length ?? 0,
    Object.keys(fileMatch?.expected_nonempty_columns ?? {}).length,
    fileMatch?.filename_contains?.length ?? 0,
  ];
}

function compareSpecificity(
  left: ResolvedCsvSourceProfile,
  right: ResolvedCsvSourceProfile,
) {
  const leftSpecificity = getSpecificity(left);
  const rightSpecificity = getSpecificity(right);

  for (let index = 0; index < leftSpecificity.length; index += 1) {
    if (leftSpecificity[index] !== rightSpecificity[index]) {
      return rightSpecificity[index] - leftSpecificity[index];
    }
  }

  return left.profile.id.localeCompare(right.profile.id);
}

function hasEqualSpecificity(
  left: ResolvedCsvSourceProfile,
  right: ResolvedCsvSourceProfile,
) {
  const leftSpecificity = getSpecificity(left);
  const rightSpecificity = getSpecificity(right);

  return leftSpecificity.every(
    (value, index) => value === rightSpecificity[index],
  );
}

function loadCsvSourceMappingProfile(filePath: string) {
  const rawProfile = loadYaml(readFileSync(filePath, "utf8"));

  if (!isCsvSourceMappingProfile(rawProfile)) {
    throw new Error(`Invalid source mapping profile: ${filePath}`);
  }

  return rawProfile;
}

export function loadCsvSourceMappingProfiles() {
  return readdirSync(SOURCE_MAPPINGS_DIRECTORY)
    .filter((fileName) => fileName.endsWith(".yaml") || fileName.endsWith(".yml"))
    .sort()
    .map((fileName) =>
      loadCsvSourceMappingProfile(join(SOURCE_MAPPINGS_DIRECTORY, fileName)),
    );
}

export function isHeaderlessCsvProfile(profile: CsvSourceMappingProfile) {
  return profile.file_match?.header_row === "absent";
}

export function resolveCsvSourceProfile({
  fileName,
  firstRow,
}: {
  fileName: string;
  firstRow: string[];
}) {
  const matches = loadCsvSourceMappingProfiles()
    .map((profile) => {
      const fileMatch = profile.file_match;
      const matchedBy: CsvMappingMatchMode[] = [];

      if (fileMatch?.filename_contains?.length) {
        if (!matchesFileName(fileName, fileMatch.filename_contains)) {
          return null;
        }

        matchedBy.push("filename");
      }

      if (isHeaderlessCsvProfile(profile)) {
        if (!matchesColumnShape(firstRow, fileMatch?.expected_nonempty_columns)) {
          return null;
        }

        matchedBy.push("column-shape");
      } else if (fileMatch?.required_headers?.length) {
        if (!matchesRequiredHeaders(firstRow, fileMatch.required_headers)) {
          return null;
        }

        matchedBy.push("header-signature");
      }

      if (matchedBy.length === 0) {
        return null;
      }

      return {
        profile,
        matchedBy,
      } satisfies ResolvedCsvSourceProfile;
    })
    .filter((match): match is ResolvedCsvSourceProfile => Boolean(match))
    .sort(compareSpecificity);

  if (matches.length > 1 && hasEqualSpecificity(matches[0], matches[1])) {
    throw new Error(
      `Ambiguous source mapping profiles for ${fileName}: ${matches
        .slice(0, 2)
        .map((match) => match.profile.id)
        .join(", ")}`,
    );
  }

  return matches[0] ?? null;
}

export function inferCsvColumnMapping(headers: string[]) {
  const mapping: Partial<CsvColumnMapping> = {};

  for (const [field, aliases] of Object.entries(candidateColumns) as Array<
    [keyof CsvColumnMapping, string[]]
  >) {
    mapping[field] = matchColumn(headers, aliases);
  }

  if (!mapping.postedAt || !mapping.description || !mapping.amount) {
    throw new Error(
      "CSV file must include columns for date, description, and amount.",
    );
  }

  return mapping as CsvColumnMapping;
}
