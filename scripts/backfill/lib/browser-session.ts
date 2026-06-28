import { access, chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { chromium, type BrowserContext, type Download, type Page } from "playwright";

import { finalizeDownload } from "./downloads.ts";
import { createSafeLogger } from "./logging.ts";
import type {
  BrowserSessionOptions,
  ExportChunk,
  PortalAdapter,
  PortalExportContext,
  SafeLogger,
} from "./types.ts";

const TRACKER_HOST_PATTERNS = [
  /(^|\.)google-analytics\.com$/i,
  /(^|\.)googletagmanager\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)hotjar\.com$/i,
  /(^|\.)fullstory\.com$/i,
];

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function isHostAllowed(hostname: string, allowedHostPatterns: RegExp[]): boolean {
  return allowedHostPatterns.some((pattern) => pattern.test(hostname));
}

function isTrackerHost(hostname: string): boolean {
  return TRACKER_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function sessionPath(portalId: string): string {
  return join(homedir(), ".finance-tracker", "sessions", `${portalId}.json`);
}

async function ensureDropboxDir(dropboxDir: string): Promise<void> {
  await mkdir(dropboxDir, { recursive: true });
}

async function ensureSessionDir(): Promise<void> {
  await mkdir(join(homedir(), ".finance-tracker", "sessions"), {
    recursive: true,
    mode: 0o700,
  });
}

async function savedSessionExists(portalId: string): Promise<boolean> {
  try {
    await access(sessionPath(portalId));
    return true;
  } catch {
    return false;
  }
}

export class SecureBrowserSession {
  private profileDir: string | null = null;
  private context: BrowserContext | null = null;
  private readonly log: SafeLogger;
  private readonly adapter: PortalAdapter;

  constructor(adapter: PortalAdapter) {
    this.adapter = adapter;
    this.log = createSafeLogger(this.adapter.definition.id);
  }

  async runExport(
    chunk: ExportChunk,
    options: BrowserSessionOptions,
  ): Promise<string> {
    const { definition } = this.adapter;

    await ensureDropboxDir(options.dropboxDir);

    this.profileDir = await mkdtemp(join(tmpdir(), "finance-csv-"));
    this.log.info("Created ephemeral browser profile");

    const storageStatePath =
      options.useSavedSession && (await savedSessionExists(definition.id))
        ? sessionPath(definition.id)
        : undefined;

    if (storageStatePath) {
      this.log.info("Using saved session state");
    }

    try {
      this.context = await chromium.launchPersistentContext(this.profileDir, {
        headless: options.headless,
        acceptDownloads: true,
        downloadsPath: options.dropboxDir,
        locale: "en-US",
        timezoneId: "America/New_York",
        bypassCSP: false,
        ignoreHTTPSErrors: false,
        viewport: { width: 1280, height: 900 },
        ...(storageStatePath ? { storageState: storageStatePath } : {}),
      });

      await this.installNetworkGuards(this.context, definition.allowedHostPatterns);

      const page = this.context.pages()[0] ?? (await this.context.newPage());
      const exportContext = this.buildExportContext(page, chunk, options);

      await this.adapter.runExport(exportContext);

      if (options.saveSession) {
        await this.saveSessionState(definition.id);
      }

      const targetName = `${definition.filePrefix}${chunk.startDate}_${chunk.endDate}.csv`;
      return join(options.dropboxDir, targetName);
    } finally {
      await this.destroy();
    }
  }

  private buildExportContext(
    page: Page,
    chunk: ExportChunk,
    options: BrowserSessionOptions,
  ): PortalExportContext {
    const { definition } = this.adapter;

    return {
      page,
      context: this.context!,
      chunk,
      credentials: {
        username: process.env[definition.credentialEnvKeys.user]?.trim() ?? "",
        password: process.env[definition.credentialEnvKeys.pass]?.trim() ?? "",
      },
      dropboxDir: options.dropboxDir,
      headed: !options.headless,
      waitForMfa: () => this.waitForMfa(!options.headless),
      expectDownload: (trigger) =>
        this.expectDownload(page, trigger, options.dropboxDir, chunk),
      log: this.log,
    };
  }

  private async installNetworkGuards(
    context: BrowserContext,
    allowedHostPatterns: RegExp[],
  ): Promise<void> {
    await context.route("**/*", (route) => {
      const hostname = hostnameFromUrl(route.request().url());
      if (!hostname) {
        route.abort();
        return;
      }

      if (isTrackerHost(hostname)) {
        route.abort();
        return;
      }

      if (isHostAllowed(hostname, allowedHostPatterns)) {
        route.continue();
        return;
      }

      this.log.warn(`Blocked request to ${hostname}`);
      route.abort();
    });
  }

  private async saveSessionState(portalId: string): Promise<void> {
    if (!this.context) {
      return;
    }

    await ensureSessionDir();
    const path = sessionPath(portalId);
    await this.context.storageState({ path });
    await chmod(path, 0o600);
    this.log.info(`Saved session state to ${path}`);
  }

  private async waitForMfa(headed: boolean): Promise<void> {
    if (!headed) {
      throw new Error(
        "MFA required. Re-run with --headed so you can complete verification in the browser.",
      );
    }

    const rl = createInterface({ input, output });
    try {
      this.log.info("Complete MFA in the browser window, then press Enter here...");
      await rl.question("");
    } finally {
      rl.close();
    }
  }

  private async expectDownload(
    page: Page,
    trigger: () => Promise<void>,
    dropboxDir: string,
    chunk: ExportChunk,
  ): Promise<Download> {
    const downloadPromise = page.waitForEvent("download", { timeout: 120_000 });
    await trigger();
    const download = await downloadPromise;

    await finalizeDownload(
      download,
      dropboxDir,
      this.adapter.definition.filePrefix,
      chunk,
      this.log,
    );

    return download;
  }

  async destroy(): Promise<void> {
    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.profileDir) {
      await rm(this.profileDir, { recursive: true, force: true });
      this.log.info("Destroyed ephemeral browser profile");
      this.profileDir = null;
    }
  }
}
