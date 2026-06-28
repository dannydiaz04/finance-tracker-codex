import type { BrowserContext, Download, Page } from "playwright";

export type PortalId =
  | "apple_card"
  | "capital_one"
  | "chase"
  | "discover"
  | "american_express"
  | "micro_center";

export interface ExportChunk {
  startDate: string;
  endDate: string;
}

export interface PortalCredentials {
  username: string;
  password: string;
}

export interface PortalDefinition {
  id: PortalId;
  label: string;
  filePrefix: string;
  loginUrl: string;
  allowedHostPatterns: RegExp[];
  credentialEnvKeys: {
    user: string;
    pass: string;
  };
}

export interface BrowserSessionOptions {
  headless: boolean;
  dropboxDir: string;
  useSavedSession: boolean;
  saveSession: boolean;
}

export interface PortalExportContext {
  page: Page;
  context: BrowserContext;
  chunk: ExportChunk;
  credentials: PortalCredentials;
  dropboxDir: string;
  headed: boolean;
  waitForMfa: () => Promise<void>;
  expectDownload: (trigger: () => Promise<void>) => Promise<Download>;
  log: SafeLogger;
}

export interface SafeLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface PortalAdapter {
  definition: PortalDefinition;
  runExport: (ctx: PortalExportContext) => Promise<void>;
}

export interface ExportResult {
  portal: PortalId;
  chunk: ExportChunk;
  outputPath: string;
  downloadedAt: string;
}
