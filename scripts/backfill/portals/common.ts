import type { PortalExportContext } from "../lib/types.ts";

/**
 * Navigate to the portal login page and wait for the document to settle.
 * Portal adapters call this before filling credentials.
 */
export async function openLoginPage(ctx: PortalExportContext, loginUrl: string): Promise<void> {
  ctx.log.info(`Opening login page`);
  await ctx.page.goto(loginUrl, { waitUntil: "domcontentloaded" });
}

/**
 * Fill username/password fields without logging values.
 * Selectors are portal-specific — pass them from each adapter.
 */
export async function submitCredentials(
  ctx: PortalExportContext,
  selectors: {
    username: string;
    password: string;
    submit: string;
  },
): Promise<void> {
  await ctx.page.locator(selectors.username).fill(ctx.credentials.username);
  await ctx.page.locator(selectors.password).fill(ctx.credentials.password);
  await ctx.page.locator(selectors.submit).click();
}

/**
 * Placeholder for portal adapters that are not implemented yet.
 */
export function notImplemented(portalLabel: string, filePath: string): never {
  throw new Error(
    `${portalLabel} export is not implemented. Add selectors and download steps in ${filePath}`,
  );
}

/**
 * Skeleton for date-range + CSV download steps every adapter must implement.
 */
export async function exportNotImplemented(
  ctx: PortalExportContext,
  portalLabel: string,
  filePath: string,
): Promise<void> {
  ctx.log.info(
    `Chunk ${ctx.chunk.startDate} → ${ctx.chunk.endDate} — implement export flow next`,
  );
  notImplemented(portalLabel, filePath);
}
