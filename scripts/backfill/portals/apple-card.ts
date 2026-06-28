import type { Frame, Page } from "playwright";

import type { PortalExportContext } from "../lib/types.ts";

import { openLoginPage } from "./common.ts";

// Apple Card web export reality (verified against support.apple.com/en-us/102284):
//   1. card.apple.com → Apple ID sign-in (account name → password → 2FA)
//   2. Sidebar "Statements" → "Export Transactions"
//   3. Pick start/end date → choose CSV → Export
//
// HARD CONSTRAINT: the date-range export only allows a start date on or after
// 2025-01-01. For anything older, Apple requires per-statement export (one
// closed monthly statement at a time), which this adapter does not automate.
const APPLE_RANGE_EXPORT_FLOOR = "2025-01-01";

/**
 * Apple ID sign-in renders inside an auth widget that is sometimes an iframe
 * (idmsa.apple.com) and sometimes inline. Resolve whichever scope currently
 * holds the account-name field so selectors work in both layouts.
 */
async function resolveAuthScope(page: Page): Promise<Page | Frame> {
  const accountSelector = "input#account_name_text_field, input[name='accountName']";

  const mainField = page.locator(accountSelector);
  if (await mainField.count().catch(() => 0)) {
    return page;
  }

  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) {
      continue;
    }
    const field = frame.locator(accountSelector);
    if (await field.count().catch(() => 0)) {
      return frame;
    }
  }

  return page;
}

async function signIn(ctx: PortalExportContext): Promise<void> {
  const { page, credentials, log } = ctx;

  // Apple widget loads async — give it room before resolving the scope.
  await page.waitForTimeout(2_500);
  const scope = await resolveAuthScope(page);

  const accountField = scope.locator(
    "input#account_name_text_field, input[name='accountName']",
  );
  await accountField.first().waitFor({ state: "visible", timeout: 30_000 });
  await accountField.first().fill(credentials.username);

  // Apple usually advances with Enter; a Continue button exists as fallback.
  await accountField.first().press("Enter");
  const continueButton = scope.locator("button#continue, button#sign-in");
  if (await continueButton.count().catch(() => 0)) {
    await continueButton.first().click().catch(() => undefined);
  }

  const passwordField = scope.locator(
    "input#password_text_field, input[name='password']",
  );
  await passwordField.first().waitFor({ state: "visible", timeout: 30_000 });
  await passwordField.first().fill(credentials.password);
  await passwordField.first().press("Enter");

  const signInButton = scope.locator("button#sign-in");
  if (await signInButton.count().catch(() => 0)) {
    await signInButton.first().click().catch(() => undefined);
  }

  log.info("Submitted Apple ID credentials; waiting for two-factor prompt");

  // 2FA is effectively always on for Apple Card. Pause for the human.
  await ctx.waitForMfa();
}

/** Apple's export modal expects MM/DD/YYYY text. */
function toAppleDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

async function openExportModal(ctx: PortalExportContext): Promise<void> {
  const { page, log } = ctx;

  await page
    .getByRole("link", { name: /statements/i })
    .or(page.getByRole("button", { name: /statements/i }))
    .first()
    .click({ timeout: 30_000 });

  log.info("Opened Statements");

  await page
    .getByRole("button", { name: /export transactions/i })
    .or(page.getByRole("link", { name: /export transactions/i }))
    .first()
    .click({ timeout: 30_000 });

  log.info("Opened Export Transactions modal");
}

async function fillExportForm(ctx: PortalExportContext): Promise<void> {
  const { page, chunk } = ctx;

  const startValue = toAppleDate(chunk.startDate);
  const endValue = toAppleDate(chunk.endDate);

  // Date fields: prefer accessible labels, fall back to ordered date inputs.
  const startField = page
    .getByLabel(/start date/i)
    .or(page.locator("input[type='date'], input[placeholder*='MM']").first());
  const endField = page
    .getByLabel(/end date/i)
    .or(page.locator("input[type='date'], input[placeholder*='MM']").nth(1));

  await startField.first().fill(startValue);
  await endField.first().fill(endValue);

  // Format selection: choose CSV (radio or option labelled CSV).
  const csvOption = page
    .getByRole("radio", { name: /csv|comma/i })
    .or(page.getByText(/comma separated values|\.csv|csv/i).first());
  if (await csvOption.count().catch(() => 0)) {
    await csvOption.first().click().catch(() => undefined);
  }
}

export const appleCardAdapter = {
  definition: {
    id: "apple_card" as const,
    label: "Apple Card",
    filePrefix: "apple_card-",
    loginUrl: "https://card.apple.com/",
    allowedHostPatterns: [
      /(^|\.)apple\.com$/i, // card.apple.com, idmsa.apple.com, appleid.apple.com
      /(^|\.)icloud\.com$/i,
      /(^|\.)cdn-apple\.com$/i,
    ],
    credentialEnvKeys: {
      user: "BACKFILL_APPLE_ID",
      pass: "BACKFILL_APPLE_PASS",
    },
  },

  async runExport(ctx: PortalExportContext) {
    if (ctx.chunk.startDate < APPLE_RANGE_EXPORT_FLOOR) {
      throw new Error(
        `Apple Card range export only supports start dates on or after ${APPLE_RANGE_EXPORT_FLOOR}. ` +
          `For ${ctx.chunk.startDate} export per-statement CSVs manually from closed statements instead.`,
      );
    }

    await openLoginPage(ctx, this.definition.loginUrl);
    await signIn(ctx);
    await openExportModal(ctx);

    await ctx.expectDownload(async () => {
      await fillExportForm(ctx);
      await ctx.page
        .getByRole("button", { name: /^export$/i })
        .first()
        .click({ timeout: 30_000 });
    });

    ctx.log.info("Apple Card export downloaded");
  },
};
