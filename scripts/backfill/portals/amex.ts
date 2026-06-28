import type { PortalAdapter } from "../lib/types.ts";

import { exportNotImplemented, openLoginPage } from "./common.ts";

const ADAPTER_PATH = "scripts/backfill/portals/amex.ts";

export const amexAdapter: PortalAdapter = {
  definition: {
    id: "american_express",
    label: "American Express",
    filePrefix: "american_express-",
    loginUrl: "https://www.americanexpress.com/",
    allowedHostPatterns: [/(^|\.)americanexpress\.com$/i],
    credentialEnvKeys: {
      user: "BACKFILL_AMEX_USER",
      pass: "BACKFILL_AMEX_PASS",
    },
  },

  async runExport(ctx) {
    await openLoginPage(ctx, this.definition.loginUrl);

    // TODO: Statements & Activity → Download CSV

    await exportNotImplemented(ctx, this.definition.label, ADAPTER_PATH);
  },
};
