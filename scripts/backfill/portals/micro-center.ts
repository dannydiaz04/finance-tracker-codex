import type { PortalAdapter } from "../lib/types.ts";

import { exportNotImplemented, openLoginPage } from "./common.ts";

const ADAPTER_PATH = "scripts/backfill/portals/micro-center.ts";

export const microCenterAdapter: PortalAdapter = {
  definition: {
    id: "micro_center",
    label: "Micro Center Card",
    filePrefix: "micro_center-",
    loginUrl: "https://www.wellsfargo.com/",
    allowedHostPatterns: [/(^|\.)wellsfargo\.com$/i, /(^|\.)microcenter\.com$/i],
    credentialEnvKeys: {
      user: "BACKFILL_MICROCENTER_USER",
      pass: "BACKFILL_MICROCENTER_PASS",
    },
  },

  async runExport(ctx) {
    await openLoginPage(ctx, this.definition.loginUrl);

    // TODO: Confirm issuer portal — some Micro Center cards are serviced by Wells Fargo.
    // Update loginUrl and allowedHostPatterns once confirmed.

    await exportNotImplemented(ctx, this.definition.label, ADAPTER_PATH);
  },
};
