import type { PortalAdapter } from "../lib/types.ts";

import { exportNotImplemented, openLoginPage } from "./common.ts";

const ADAPTER_PATH = "scripts/backfill/portals/capital-one.ts";

export const capitalOneAdapter: PortalAdapter = {
  definition: {
    id: "capital_one",
    label: "Capital One 360 Checking",
    filePrefix: "capital_one-",
    loginUrl: "https://www.capitalone.com/",
    allowedHostPatterns: [
      /(^|\.)capitalone\.com$/i,
      /(^|\.)capitalone360\.com$/i,
    ],
    credentialEnvKeys: {
      user: "BACKFILL_CAPITALONE_USER",
      pass: "BACKFILL_CAPITALONE_PASS",
    },
  },

  async runExport(ctx) {
    await openLoginPage(ctx, this.definition.loginUrl);

    // TODO: Sign in → 360 Checking (...5980) → Transactions → Download CSV
    // await submitCredentials(ctx, { username: "...", password: "...", submit: "..." });
    // await ctx.waitForMfa();
    // Set date range: ctx.chunk.startDate / ctx.chunk.endDate
    // await ctx.expectDownload(async () => { ... });

    await exportNotImplemented(ctx, this.definition.label, ADAPTER_PATH);
  },
};
