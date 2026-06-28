import { rename } from "node:fs/promises";
import { join } from "node:path";

import type { Download } from "playwright";

import type { ExportChunk, SafeLogger } from "./types.ts";

export function buildTargetFilename(
  filePrefix: string,
  chunk: ExportChunk,
): string {
  return `${filePrefix}${chunk.startDate}_${chunk.endDate}.csv`;
}

export async function finalizeDownload(
  download: Download,
  dropboxDir: string,
  filePrefix: string,
  chunk: ExportChunk,
  log: SafeLogger,
): Promise<string> {
  const targetName = buildTargetFilename(filePrefix, chunk);
  const targetPath = join(dropboxDir, targetName);
  const suggested = download.suggestedFilename();

  await download.saveAs(targetPath);

  log.info(
    `Saved export as ${targetName} (browser suggested: ${suggested || "unknown"})`,
  );

  return targetPath;
}

export async function renameExistingDownload(
  sourcePath: string,
  dropboxDir: string,
  filePrefix: string,
  chunk: ExportChunk,
  log: SafeLogger,
): Promise<string> {
  const targetName = buildTargetFilename(filePrefix, chunk);
  const targetPath = join(dropboxDir, targetName);

  await rename(sourcePath, targetPath);
  log.info(`Renamed download to ${targetName}`);

  return targetPath;
}
