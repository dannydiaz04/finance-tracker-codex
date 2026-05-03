import "server-only";

import { Storage } from "@google-cloud/storage";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import pathPosix from "node:path/posix";

import {
  parseCsvImport,
  persistCsvImport,
  type ParsedCsvImport,
} from "./csv.ts";
import type { CsvImportRuntimeAccountContext } from "./mapping.ts";

const LANDING_DIRECTORY_NAMES = [
  "incoming",
  "processing",
  "archive",
  "rejected",
] as const;

const RESULT_MANIFEST_SUFFIX = ".result.json";
const CONTEXT_MANIFEST_SUFFIX = ".context.json";
const GCS_URI_PREFIX = "gs://";

let storageClient: Storage | null = null;

export type LandingDirectoryName = (typeof LANDING_DIRECTORY_NAMES)[number];

export type LandingFailureReason =
  | "UNSUPPORTED_FORMAT"
  | "EMPTY_FILE"
  | "PARSE_ERROR"
  | "LOAD_ERROR";

export type LandingFileFormat = "csv";

export type LandingRunResult = {
  landingRoot: string;
  storageBackend: "local" | "gcs";
  processedCount: number;
  archivedCount: number;
  rejectedCount: number;
  results: LandingFileResult[];
};

export type LandingFileResult = {
  fileName: string;
  relativePath: string;
  sourceSystem: string | null;
  status: "archived" | "rejected";
  fileFormat: LandingFileFormat | null;
  fileSizeBytes: number;
  fileChecksum: string;
  runtimeAccountContext: Partial<CsvImportRuntimeAccountContext>;
  importBatchId: string | null;
  rowCount: number | null;
  mappingResolutionStrategy: ParsedCsvImport["mappingResolution"]["strategy"] | null;
  mappingProfileId: string | null;
  matchedBy: string[];
  archivedFilePath: string | null;
  rejectedFilePath: string | null;
  contextManifestPath: string | null;
  resultManifestPath: string;
  processedAt: string;
  failureReason: LandingFailureReason | null;
  errorMessage: string | null;
};

export type LandingRunnerOptions = {
  landingRoot?: string;
  maxFiles?: number;
  sourceSystem?: string;
  persistImport?: (
    parsedImport: ParsedCsvImport,
  ) => Promise<Awaited<ReturnType<typeof persistCsvImport>>>;
  now?: () => Date;
};

type LandingPaths = Record<LandingDirectoryName, string> & {
  root: string;
  storageBackend: "local" | "gcs";
};

type ClaimedLandingFile = {
  claimedFilePath: string;
  claimedContextPath: string | null;
  relativePath: string;
};

type FileInspection = {
  fileSizeBytes: number;
  fileChecksum: string;
};

class LandingRunnerError extends Error {
  reason: LandingFailureReason;

  constructor(reason: LandingFailureReason, message: string) {
    super(message);
    this.name = "LandingRunnerError";
    this.reason = reason;
  }
}

function normalizeTextInput(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeGcsRootUri(uri: string) {
  const trimmedUri = uri.trim();

  if (!trimmedUri.startsWith(GCS_URI_PREFIX)) {
    return trimmedUri;
  }

  const withoutTrailingSlash = trimmedUri.replace(/\/+$/, "");
  return withoutTrailingSlash === "gs:" ? GCS_URI_PREFIX : withoutTrailingSlash;
}

function resolveLandingRoot(landingRoot?: string) {
  const configuredLandingRoot =
    landingRoot ??
    process.env.WAREHOUSE_LANDING_ROOT ??
    process.env.WAREHOUSE_LANDING_URI;

  if (configuredLandingRoot?.trim().startsWith(GCS_URI_PREFIX)) {
    return normalizeGcsRootUri(configuredLandingRoot);
  }

  const landingBucket = normalizeTextInput(process.env.WAREHOUSE_LANDING_BUCKET);

  if (!configuredLandingRoot && landingBucket) {
    return normalizeGcsRootUri(`${GCS_URI_PREFIX}${landingBucket}`);
  }

  return resolve(
    configuredLandingRoot ?? join(process.cwd(), "landing-zone"),
  );
}

function getLandingPaths(landingRoot?: string): LandingPaths {
  const root = resolveLandingRoot(landingRoot);
  const storageBackend = root.startsWith(GCS_URI_PREFIX) ? "gcs" : "local";

  return {
    root,
    storageBackend,
    incoming: joinLandingPath(root, "incoming"),
    processing: joinLandingPath(root, "processing"),
    archive: joinLandingPath(root, "archive"),
    rejected: joinLandingPath(root, "rejected"),
  };
}

function getStorageClient() {
  storageClient ??= new Storage();
  return storageClient;
}

function isGcsUri(value: string) {
  return value.startsWith(GCS_URI_PREFIX);
}

function parseGcsUri(uri: string) {
  if (!isGcsUri(uri)) {
    throw new Error(`Expected a GCS URI, received: ${uri}`);
  }

  const pathWithoutScheme = uri.slice(GCS_URI_PREFIX.length);
  const [bucketName, ...objectPathParts] = pathWithoutScheme.split("/");
  const objectName = objectPathParts.join("/");

  if (!bucketName) {
    throw new Error(`GCS URI is missing a bucket name: ${uri}`);
  }

  return {
    bucketName,
    objectName,
  };
}

function toGcsUri(bucketName: string, objectName: string) {
  const normalizedObjectName = objectName.replace(/^\/+/, "");
  return normalizedObjectName
    ? `${GCS_URI_PREFIX}${bucketName}/${normalizedObjectName}`
    : `${GCS_URI_PREFIX}${bucketName}`;
}

function joinLandingPath(root: string, ...segments: string[]) {
  if (!isGcsUri(root)) {
    return join(root, ...segments);
  }

  const { bucketName, objectName } = parseGcsUri(root);
  const joinedObjectName = pathPosix.join(
    objectName,
    ...segments.map((segment) => segment.replace(/^\/+|\/+$/g, "")),
  );

  return toGcsUri(bucketName, joinedObjectName);
}

function getLandingPathBaseName(filePath: string) {
  return isGcsUri(filePath)
    ? pathPosix.basename(parseGcsUri(filePath).objectName)
    : basename(filePath);
}

function getLandingPathExtension(filePath: string) {
  return isGcsUri(filePath)
    ? pathPosix.extname(parseGcsUri(filePath).objectName)
    : extname(filePath);
}

function getLandingPathRelative(basePath: string, filePath: string) {
  if (!isGcsUri(basePath)) {
    return relative(basePath, filePath);
  }

  const base = parseGcsUri(basePath);
  const file = parseGcsUri(filePath);

  if (base.bucketName !== file.bucketName) {
    return `../${file.objectName}`;
  }

  const normalizedBaseObjectName = base.objectName.replace(/\/+$/, "");
  const normalizedFileObjectName = file.objectName.replace(/^\/+/, "");

  if (!normalizedBaseObjectName) {
    return normalizedFileObjectName;
  }

  const prefix = `${normalizedBaseObjectName}/`;
  return normalizedFileObjectName.startsWith(prefix)
    ? normalizedFileObjectName.slice(prefix.length)
    : `../${normalizedFileObjectName}`;
}

async function pathExists(filePath: string) {
  if (isGcsUri(filePath)) {
    const { bucketName, objectName } = parseGcsUri(filePath);
    const [exists] = await getStorageClient()
      .bucket(bucketName)
      .file(objectName)
      .exists();

    return exists;
  }

  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function isAuxiliaryLandingFile(fileName: string) {
  return (
    fileName.endsWith(CONTEXT_MANIFEST_SUFFIX) ||
    fileName.endsWith(RESULT_MANIFEST_SUFFIX)
  );
}

function getContextManifestPath(filePath: string) {
  return `${filePath}${CONTEXT_MANIFEST_SUFFIX}`;
}

function getResultManifestPath(filePath: string) {
  return `${filePath}${RESULT_MANIFEST_SUFFIX}`;
}

function getMirroredLandingPath(
  paths: LandingPaths,
  fromDirectory: LandingDirectoryName,
  toDirectory: LandingDirectoryName,
  filePath: string,
) {
  const relativePath = getLandingPathRelative(paths[fromDirectory], filePath);

  if (!relativePath || relativePath.startsWith("..")) {
    throw new Error(
      `Cannot mirror landing path outside ${fromDirectory}: ${filePath}`,
    );
  }

  return joinLandingPath(paths[toDirectory], relativePath);
}

function getSourceSystemFromRelativePath(relativePath: string) {
  const [sourceSystem] = relativePath.split(/[\\/]/);
  return sourceSystem?.trim() ? sourceSystem : null;
}

function detectLandingFileFormat(fileName: string): LandingFileFormat | null {
  return getLandingPathExtension(fileName).toLowerCase() === ".csv" ? "csv" : null;
}

function buildRuntimeAccountContext(input: unknown) {
  const candidate =
    input && typeof input === "object"
      ? (input as {
          runtimeAccountContext?: Partial<CsvImportRuntimeAccountContext>;
          sourceAccountId?: unknown;
          accountName?: unknown;
          accountMask?: unknown;
        })
      : {};

  const nestedContext = candidate.runtimeAccountContext ?? {};
  const sourceAccountId =
    normalizeTextInput(candidate.sourceAccountId) ||
    normalizeTextInput(nestedContext.sourceAccountId);
  const accountName =
    normalizeTextInput(candidate.accountName) ||
    normalizeTextInput(nestedContext.accountName);
  const accountMask =
    normalizeTextInput(candidate.accountMask) ||
    normalizeTextInput(nestedContext.accountMask);

  return {
    ...(sourceAccountId ? { sourceAccountId } : {}),
    ...(accountName ? { accountName } : {}),
    ...(accountMask ? { accountMask } : {}),
  } satisfies Partial<CsvImportRuntimeAccountContext>;
}

async function collectLandingFiles(directoryPath: string): Promise<string[]> {
  const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    directoryEntries.map(async (entry) => {
      const entryPath = join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        return collectLandingFiles(entryPath);
      }

      if (!entry.isFile() || isAuxiliaryLandingFile(entry.name)) {
        return [];
      }

      return [entryPath];
    }),
  );

  return nestedFiles.flat().sort((left, right) => left.localeCompare(right));
}

async function collectGcsLandingFiles(prefixUri: string): Promise<string[]> {
  const { bucketName, objectName } = parseGcsUri(prefixUri);
  const prefix = objectName ? `${objectName.replace(/\/+$/, "")}/` : "";
  const [files] = await getStorageClient().bucket(bucketName).getFiles({
    prefix,
  });

  return files
    .map((file) => toGcsUri(bucketName, file.name))
    .filter((filePath) => {
      const fileName = getLandingPathBaseName(filePath);
      return fileName && fileName !== ".keep" && !isAuxiliaryLandingFile(fileName);
    })
    .sort((left, right) => left.localeCompare(right));
}

async function inspectLandingFile(filePath: string): Promise<FileInspection> {
  if (isGcsUri(filePath)) {
    const fileBuffer = await readLandingFileBuffer(filePath);

    return {
      fileSizeBytes: fileBuffer.byteLength,
      fileChecksum: createHash("sha256").update(fileBuffer).digest("hex"),
    };
  }

  const [fileStats, fileBuffer] = await Promise.all([stat(filePath), readFile(filePath)]);

  return {
    fileSizeBytes: fileStats.size,
    fileChecksum: createHash("sha256").update(fileBuffer).digest("hex"),
  };
}

async function ensureDirectoryExists(directoryPath: string) {
  if (isGcsUri(directoryPath)) {
    return;
  }

  await mkdir(directoryPath, { recursive: true });
}

async function readLandingFileBuffer(filePath: string) {
  if (!isGcsUri(filePath)) {
    return readFile(filePath);
  }

  const { bucketName, objectName } = parseGcsUri(filePath);
  const [fileBuffer] = await getStorageClient()
    .bucket(bucketName)
    .file(objectName)
    .download();

  return fileBuffer;
}

async function readLandingTextFile(filePath: string) {
  const fileBuffer = await readLandingFileBuffer(filePath);
  return fileBuffer.toString("utf8");
}

async function writeLandingTextFile(filePath: string, contents: string) {
  if (!isGcsUri(filePath)) {
    await writeFile(filePath, contents, "utf8");
    return;
  }

  const { bucketName, objectName } = parseGcsUri(filePath);
  await getStorageClient()
    .bucket(bucketName)
    .file(objectName)
    .save(contents, {
      contentType: "application/json",
      resumable: false,
    });
}

async function moveFile(sourcePath: string, destinationPath: string) {
  if (isGcsUri(sourcePath) || isGcsUri(destinationPath)) {
    const source = parseGcsUri(sourcePath);
    const destination = parseGcsUri(destinationPath);
    const sourceFile = getStorageClient()
      .bucket(source.bucketName)
      .file(source.objectName);

    await sourceFile.copy(
      getStorageClient()
        .bucket(destination.bucketName)
        .file(destination.objectName),
    );
    await sourceFile.delete();
    return;
  }

  await ensureDirectoryExists(dirname(destinationPath));
  await rename(sourcePath, destinationPath);
}

async function claimLandingFile(
  filePath: string,
  paths: LandingPaths,
): Promise<ClaimedLandingFile> {
  const relativePath = getLandingPathRelative(paths.incoming, filePath);

  if (!relativePath || relativePath.startsWith("..")) {
    throw new Error(`Incoming file is outside landing root: ${filePath}`);
  }

  const claimedFilePath = joinLandingPath(paths.processing, relativePath);
  const contextManifestPath = getContextManifestPath(filePath);
  const claimedContextPath = getContextManifestPath(claimedFilePath);

  await moveFile(filePath, claimedFilePath);

  if (await pathExists(contextManifestPath)) {
    await moveFile(contextManifestPath, claimedContextPath);
    return {
      claimedFilePath,
      claimedContextPath,
      relativePath,
    };
  }

  return {
    claimedFilePath,
    claimedContextPath: null,
    relativePath,
  };
}

async function loadRuntimeAccountContext(
  contextManifestPath: string | null,
): Promise<Partial<CsvImportRuntimeAccountContext>> {
  if (!contextManifestPath) {
    return {};
  }

  const rawManifest = await readLandingTextFile(contextManifestPath);
  return buildRuntimeAccountContext(JSON.parse(rawManifest));
}

async function writeResultManifest(
  resultFilePath: string,
  result: LandingFileResult,
) {
  const manifestPath = getResultManifestPath(resultFilePath);
  const manifestPayload = {
    ...result,
    resultManifestPath: manifestPath,
  } satisfies LandingFileResult;

  await writeLandingTextFile(
    manifestPath,
    `${JSON.stringify(manifestPayload, null, 2)}\n`,
  );
  return manifestPath;
}

async function moveClaimedFileTo(
  paths: LandingPaths,
  claimedFile: ClaimedLandingFile,
  destinationDirectory: Extract<LandingDirectoryName, "archive" | "rejected">,
) {
  const destinationFilePath = getMirroredLandingPath(
    paths,
    "processing",
    destinationDirectory,
    claimedFile.claimedFilePath,
  );
  const destinationContextPath = claimedFile.claimedContextPath
    ? getContextManifestPath(destinationFilePath)
    : null;

  await moveFile(claimedFile.claimedFilePath, destinationFilePath);

  if (claimedFile.claimedContextPath && destinationContextPath) {
    await moveFile(claimedFile.claimedContextPath, destinationContextPath);
  }

  return {
    filePath: destinationFilePath,
    contextManifestPath: destinationContextPath,
  };
}

function toRejectedResult(params: {
  claimedFile: ClaimedLandingFile;
  inspection: FileInspection;
  runtimeAccountContext: Partial<CsvImportRuntimeAccountContext>;
  failureReason: LandingFailureReason;
  errorMessage: string;
  rejectedFilePath: string;
  rejectedContextManifestPath: string | null;
  processedAt: string;
}) {
  return {
    fileName: getLandingPathBaseName(params.claimedFile.claimedFilePath),
    relativePath: params.claimedFile.relativePath,
    sourceSystem: getSourceSystemFromRelativePath(params.claimedFile.relativePath),
    status: "rejected" as const,
    fileFormat: detectLandingFileFormat(params.claimedFile.claimedFilePath),
    fileSizeBytes: params.inspection.fileSizeBytes,
    fileChecksum: params.inspection.fileChecksum,
    runtimeAccountContext: params.runtimeAccountContext,
    importBatchId: null,
    rowCount: null,
    mappingResolutionStrategy: null,
    mappingProfileId: null,
    matchedBy: [],
    archivedFilePath: null,
    rejectedFilePath: params.rejectedFilePath,
    contextManifestPath: params.rejectedContextManifestPath,
    resultManifestPath: "",
    processedAt: params.processedAt,
    failureReason: params.failureReason,
    errorMessage: params.errorMessage,
  } satisfies LandingFileResult;
}

function toArchivedResult(params: {
  claimedFile: ClaimedLandingFile;
  inspection: FileInspection;
  runtimeAccountContext: Partial<CsvImportRuntimeAccountContext>;
  parsedImport: ParsedCsvImport;
  archivedFilePath: string;
  archivedContextManifestPath: string | null;
  processedAt: string;
}) {
  const mappingProfileId =
    params.parsedImport.mappingResolution.strategy === "profile"
      ? params.parsedImport.mappingResolution.profileId
      : null;
  const matchedBy =
    params.parsedImport.mappingResolution.strategy === "profile"
      ? params.parsedImport.mappingResolution.matchedBy
      : ["fallback-header-inference"];

  return {
    fileName: getLandingPathBaseName(params.claimedFile.claimedFilePath),
    relativePath: params.claimedFile.relativePath,
    sourceSystem: getSourceSystemFromRelativePath(params.claimedFile.relativePath),
    status: "archived" as const,
    fileFormat: detectLandingFileFormat(params.claimedFile.claimedFilePath),
    fileSizeBytes: params.inspection.fileSizeBytes,
    fileChecksum: params.inspection.fileChecksum,
    runtimeAccountContext: params.runtimeAccountContext,
    importBatchId: params.parsedImport.importBatch.importBatchId,
    rowCount: params.parsedImport.importBatch.rowCount,
    mappingResolutionStrategy: params.parsedImport.mappingResolution.strategy,
    mappingProfileId,
    matchedBy,
    archivedFilePath: params.archivedFilePath,
    rejectedFilePath: null,
    contextManifestPath: params.archivedContextManifestPath,
    resultManifestPath: "",
    processedAt: params.processedAt,
    failureReason: null,
    errorMessage: null,
  } satisfies LandingFileResult;
}

async function rejectClaimedFile(params: {
  paths: LandingPaths;
  claimedFile: ClaimedLandingFile;
  inspection: FileInspection;
  runtimeAccountContext: Partial<CsvImportRuntimeAccountContext>;
  failureReason: LandingFailureReason;
  errorMessage: string;
  processedAt: string;
}) {
  const rejected = await moveClaimedFileTo(
    params.paths,
    params.claimedFile,
    "rejected",
  );
  const result = toRejectedResult({
    claimedFile: params.claimedFile,
    inspection: params.inspection,
    runtimeAccountContext: params.runtimeAccountContext,
    failureReason: params.failureReason,
    errorMessage: params.errorMessage,
    rejectedFilePath: rejected.filePath,
    rejectedContextManifestPath: rejected.contextManifestPath,
    processedAt: params.processedAt,
  });

  result.resultManifestPath = await writeResultManifest(rejected.filePath, result);
  return result;
}

async function processClaimedLandingFile(
  claimedFile: ClaimedLandingFile,
  options: Required<Pick<LandingRunnerOptions, "persistImport" | "now">>,
  paths: LandingPaths,
) {
  const processedAt = options.now().toISOString();
  const inspection = await inspectLandingFile(claimedFile.claimedFilePath);
  let runtimeAccountContext: Partial<CsvImportRuntimeAccountContext>;

  try {
    runtimeAccountContext = await loadRuntimeAccountContext(
      claimedFile.claimedContextPath,
    );
  } catch (error) {
    return rejectClaimedFile({
      paths,
      claimedFile,
      inspection,
      runtimeAccountContext: {},
      failureReason: "PARSE_ERROR",
      errorMessage:
        error instanceof Error
          ? error.message
          : "Unable to read the landed context manifest.",
      processedAt,
    });
  }

  const fileFormat = detectLandingFileFormat(claimedFile.claimedFilePath);

  if (!fileFormat) {
    return rejectClaimedFile({
      paths,
      claimedFile,
      inspection,
      runtimeAccountContext,
      failureReason: "UNSUPPORTED_FORMAT",
      errorMessage:
        "Only .csv files are supported by the standalone landing runner today.",
      processedAt,
    });
  }

  const fileContents = await readLandingTextFile(claimedFile.claimedFilePath);

  if (!fileContents.trim()) {
    return rejectClaimedFile({
      paths,
      claimedFile,
      inspection,
      runtimeAccountContext,
      failureReason: "EMPTY_FILE",
      errorMessage: "Landed file was empty.",
      processedAt,
    });
  }

  let parsedImport: ParsedCsvImport;

  try {
    parsedImport = parseCsvImport(fileContents, {
      fileName: getLandingPathBaseName(claimedFile.claimedFilePath),
      runtimeAccountContext,
    });
  } catch (error) {
    return rejectClaimedFile({
      paths,
      claimedFile,
      inspection,
      runtimeAccountContext,
      failureReason: "PARSE_ERROR",
      errorMessage:
        error instanceof Error ? error.message : "Unable to parse landed CSV file.",
      processedAt,
    });
  }

  const parsedImportToPersist = {
    ...parsedImport,
    importBatch: {
      ...parsedImport.importBatch,
      status: "loaded" as const,
    },
  } satisfies ParsedCsvImport;

  try {
    const persistenceResult = await options.persistImport(parsedImportToPersist);

    if (!persistenceResult.persisted) {
      throw new LandingRunnerError("LOAD_ERROR", persistenceResult.reason);
    }
  } catch (error) {
    const message =
      error instanceof LandingRunnerError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unable to persist landed file into BigQuery.";

    return rejectClaimedFile({
      paths,
      claimedFile,
      inspection,
      runtimeAccountContext,
      failureReason: "LOAD_ERROR",
      errorMessage: message,
      processedAt,
    });
  }

  const archived = await moveClaimedFileTo(paths, claimedFile, "archive");
  const result = toArchivedResult({
    claimedFile,
    inspection,
    runtimeAccountContext,
    parsedImport: parsedImportToPersist,
    archivedFilePath: archived.filePath,
    archivedContextManifestPath: archived.contextManifestPath,
    processedAt,
  });

  result.resultManifestPath = await writeResultManifest(archived.filePath, result);
  return result;
}

export async function ensureLandingDirectories(landingRoot?: string) {
  const paths = getLandingPaths(landingRoot);

  if (paths.storageBackend === "gcs") {
    await Promise.all(
      LANDING_DIRECTORY_NAMES.map((directoryName) =>
        writeLandingTextFile(joinLandingPath(paths[directoryName], ".keep"), ""),
      ),
    );
  } else {
    await Promise.all(
      LANDING_DIRECTORY_NAMES.map((directoryName) =>
        ensureDirectoryExists(paths[directoryName]),
      ),
    );
  }

  return paths;
}

export async function listIncomingLandingFiles(options: {
  landingRoot?: string;
  sourceSystem?: string;
} = {}) {
  const paths = await ensureLandingDirectories(options.landingRoot);
  const incomingRoot = options.sourceSystem
    ? joinLandingPath(paths.incoming, options.sourceSystem)
    : paths.incoming;

  if (paths.storageBackend === "gcs") {
    return collectGcsLandingFiles(incomingRoot);
  }

  if (!(await pathExists(incomingRoot))) {
    return [] as string[];
  }

  return collectLandingFiles(incomingRoot);
}

export async function runLandingImports(
  options: LandingRunnerOptions = {},
): Promise<LandingRunResult> {
  const paths = await ensureLandingDirectories(options.landingRoot);
  const maxFiles = Math.max(1, options.maxFiles ?? 1);
  const persistImport = options.persistImport ?? persistCsvImport;
  const now = options.now ?? (() => new Date());
  const incomingFiles = await listIncomingLandingFiles({
    landingRoot: paths.root,
    sourceSystem: options.sourceSystem,
  });
  const filesToProcess = incomingFiles.slice(0, maxFiles);
  const results: LandingFileResult[] = [];

  for (const filePath of filesToProcess) {
    const claimedFile = await claimLandingFile(filePath, paths);
    const result = await processClaimedLandingFile(
      claimedFile,
      {
        persistImport,
        now,
      },
      paths,
    );

    results.push(result);
  }

  return {
    landingRoot: paths.root,
    storageBackend: paths.storageBackend,
    processedCount: results.length,
    archivedCount: results.filter((result) => result.status === "archived").length,
    rejectedCount: results.filter((result) => result.status === "rejected").length,
    results,
  };
}
